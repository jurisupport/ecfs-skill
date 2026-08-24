#!/usr/bin/env python3
# 송달문서 DB 관리 — 작성서류/송달문서 폴더의 _송달문서.db (SQLite)
#
# 사용:
#   python3 ecfs-delivery-db.py import-check [delivery.json]   # 조회 결과를 DB에 반영(업서트)
#   python3 ecfs-delivery-db.py link-files                     # 폴더의 PDF를 DB 행과 매칭해 file_path 기록
#   python3 ecfs-delivery-db.py pending                        # 확인됐지만 아직 PDF 없는 문서 목록
#   python3 ecfs-delivery-db.py have-json                      # 이미 저장된 문서 목록 → _have.json (open-save --skip 용)
#   python3 ecfs-delivery-db.py list [N]                       # 최근 N건 (기본 40)
#   python3 ecfs-delivery-db.py export-csv                     # _송달문서목록.csv 생성
#
# 옵션: --dir DIR (기본: 환경변수/금고 ECFS_DELIVERY_DIR → ~/ecfs-delivery)

import csv, json, os, re, sqlite3, sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from k_secrets import secret  # noqa: E402

DEFAULT_DIR = secret("ECFS_DELIVERY_DIR", os.path.join(os.path.expanduser("~"), "ecfs-delivery"))

def base_dir():
    if "--dir" in sys.argv:
        return sys.argv[sys.argv.index("--dir") + 1]
    return DEFAULT_DIR

def db_conn(d):
    con = sqlite3.connect(os.path.join(d, "_송달문서.db"))
    con.execute("""CREATE TABLE IF NOT EXISTS delivery (
        id INTEGER PRIMARY KEY,
        court TEXT, dept TEXT, case_no TEXT, doc_name TEXT,
        reg_date TEXT,               -- 등재일
        recv_date TEXT,              -- 수신(확인)일. 미확인이면 NULL
        status TEXT,                 -- 미확인 | 확인
        file_path TEXT,              -- 저장된 PDF 파일명(폴더 기준 상대경로)
        first_seen TEXT, last_seen TEXT,
        UNIQUE(case_no, doc_name, reg_date)
    )""")
    return con

def norm(s):
    return re.sub(r"[^0-9a-zA-Z가-힣]", "", s or "")

def import_check(d):
    src = "/tmp/ecfs-check/delivery.json"
    for a in sys.argv[2:]:
        if a.endswith(".json"):
            src = a
    data = json.load(open(src))
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    con = db_conn(d)
    n_new = n_upd = 0
    # all 행: [사건표시, 법원, 재판부, 사건번호, ?, 문서명, 등재일, 수신일자, ...]
    # unconfirmed 행: 수신일자 컬럼 없음 → 미확인
    rows = []
    for r in data.get("all", []):
        recv = (r[7] or "").strip()
        rows.append((r[1], r[2], r[3], r[5], r[6],
                     None if recv in ("", "미확인") else recv,
                     "미확인" if recv in ("", "미확인") else "확인"))
    for r in data.get("unconfirmed", []):
        rows.append((r[1], r[2], r[3], r[5], r[6], None, "미확인"))
    for court, dept, case_no, doc, reg, recv, status in rows:
        cur = con.execute("SELECT id, status FROM delivery WHERE case_no=? AND doc_name=? AND reg_date=?",
                          (case_no, doc, reg))
        hit = cur.fetchone()
        if hit:
            con.execute("UPDATE delivery SET recv_date=COALESCE(?,recv_date), status=?, last_seen=? WHERE id=?",
                        (recv, status, now, hit[0]))
            if hit[1] != status:
                n_upd += 1
        else:
            con.execute("""INSERT INTO delivery (court,dept,case_no,doc_name,reg_date,recv_date,status,first_seen,last_seen)
                           VALUES (?,?,?,?,?,?,?,?,?)""",
                        (court, dept, case_no, doc, reg, recv, status, now, now))
            n_new += 1
    con.commit()
    total = con.execute("SELECT COUNT(*) FROM delivery").fetchone()[0]
    unc = con.execute("SELECT COUNT(*) FROM delivery WHERE status='미확인'").fetchone()[0]
    print(f"[import] 신규 {n_new}건, 상태변경 {n_upd}건 (DB 총 {total}건, 미확인 {unc}건)")

def link_files(d):
    con = db_conn(d)
    pdfs = [f for f in os.listdir(d) if f.lower().endswith(".pdf")]
    rows = con.execute("SELECT id, case_no, doc_name, file_path FROM delivery").fetchall()
    linked = 0
    used = set()
    for rid, case_no, doc, fp in rows:
        if fp and os.path.exists(os.path.join(d, fp)):
            used.add(fp)
            continue
        # 파일명은 부본·정본 등 접미사와 날짜괄호를 뗀 서류명으로 저장되므로 같은 형태로 비교
        core = re.sub(r"\([^)]*\)", "", doc or "").strip()
        core = re.sub(r"(부본|정본|등본|사본)$", "", core)
        nd = norm(core) or norm(doc)
        best = None
        for f in pdfs:
            if f in used:
                continue
            nf = norm(f)
            if case_no in f and (nd in nf or nd[:8] in nf):
                best = f
                break
        if best:
            con.execute("UPDATE delivery SET file_path=? WHERE id=?", (best, rid))
            used.add(best)
            linked += 1
    con.commit()
    orphans = [f for f in pdfs if f not in used]
    print(f"[link] {linked}건 매칭")
    for f in orphans:
        print("  [미매칭 PDF]", f)

def pending(d):
    con = db_conn(d)
    rows = con.execute("""SELECT court, case_no, doc_name, reg_date FROM delivery
                          WHERE status='확인' AND (file_path IS NULL OR file_path='')
                          ORDER BY reg_date DESC""").fetchall()
    print(f"[pending] 확인됐지만 PDF 미저장 {len(rows)}건")
    for r in rows:
        print("  •", " | ".join(r))

def have_json(d):
    con = db_conn(d)
    rows = con.execute("""SELECT case_no, doc_name FROM delivery
                          WHERE file_path IS NOT NULL AND file_path!=''""").fetchall()
    out = os.path.join(d, "_have.json")
    json.dump([{"caseNo": c, "docName": n} for c, n in rows],
              open(out, "w"), ensure_ascii=False, indent=1)
    print(f"[have] {len(rows)}건 → {out}")

def list_rows(d):
    n = 40
    for a in sys.argv[2:]:
        if a.isdigit():
            n = int(a)
    con = db_conn(d)
    rows = con.execute("""SELECT status, reg_date, court, case_no, doc_name,
                          COALESCE(recv_date,'-'), COALESCE(file_path,'-')
                          FROM delivery ORDER BY reg_date DESC, id DESC LIMIT ?""", (n,)).fetchall()
    for r in rows:
        mark = "🔴" if r[0] == "미확인" else ("💾" if r[6] != "-" else "  ")
        print(f"{mark} {r[1]} | {r[2]} {r[3]} | {r[4]} | 확인:{r[5]} | {r[6]}")

def export_csv(d):
    con = db_conn(d)
    rows = con.execute("""SELECT status, reg_date, recv_date, court, dept, case_no, doc_name, file_path
                          FROM delivery ORDER BY reg_date DESC, id DESC""").fetchall()
    out = os.path.join(d, "_송달문서목록.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["상태", "등재일", "확인일", "법원", "재판부", "사건번호", "문서명", "파일"])
        w.writerows(rows)
    print(f"[csv] {len(rows)}건 → {out}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    d = base_dir()
    os.makedirs(d, exist_ok=True)
    {"import-check": import_check, "link-files": link_files, "pending": pending,
     "have-json": have_json, "list": list_rows, "export-csv": export_csv}.get(cmd, list_rows)(d)
