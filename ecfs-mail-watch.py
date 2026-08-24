#!/usr/bin/env python3
# 전자소송 송달 알림 메일 감시 데몬 (IMAP IDLE)
#
# 변호사 Gmail INBOX를 IMAP IDLE로 상시 감시하다가
# scourt.go.kr 발신 + 제목에 "전자발송" 포함 메일이 오면:
#   1) 텔레그램으로 즉시 알림 (메일 제목)
#   2) 90초 대기(연속 알림 배칭) 후 ecfs-auto-fetch.js 실행
#      → 미확인 송달문서 중 안전 유형만 자동 열람·저장, 나머지는 알림만
#
# 상태: .mail-watch-state.json 에 마지막 처리 UID 저장 (재시작 시 과거 메일 재처리 방지)
# launchd(local.ecfs-mailwatch)로 상시 실행.

import imaplib
import email
import json
import os
import re
import select
import socket
import ssl
import subprocess
import sys
import time
from email.header import decode_header

HOST = 'imap.gmail.com'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from k_secrets import secret  # noqa: E402

USER = secret('GMAIL_USER')
PASS = secret('GMAIL_APP_PW')

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(SKILL_DIR, '.mail-watch-state.json')
NODE = '/opt/homebrew/bin/node'
HANDLER = os.path.join(SKILL_DIR, 'ecfs-auto-fetch.js')
TELEGRAM_ENV = os.path.expanduser('~/.claude/channels/telegram/.env')
CHAT_ID = secret('TELEGRAM_CHAT_ID')

IDLE_TIMEOUT = 240      # IDLE 1회 대기(초). 만료 시 재-IDLE (폴링 겸용)
BATCH_WAIT = 90         # 감지 후 핸들러 실행까지 대기(연속 등재 배칭)

FROM_PAT = re.compile(r'scourt\.go\.kr', re.I)
SUBJ_PAT = re.compile(r'전자발송')


def log(*a):
    print(time.strftime('[%Y-%m-%d %H:%M:%S]'), *a, flush=True)


def tg_token():
    with open(TELEGRAM_ENV) as f:
        m = re.search(r'TELEGRAM_BOT_TOKEN=(\S+)', f.read())
    return m.group(1) if m else None


def tg_send(text):
    tok = tg_token()
    if not tok:
        return
    try:
        subprocess.run(['curl', '-s', '-X', 'POST',
                        f'https://api.telegram.org/bot{tok}/sendMessage',
                        '-d', f'chat_id={CHAT_ID}',
                        '--data-urlencode', f'text={text}'],
                       timeout=30, capture_output=True)
    except Exception as e:
        log('텔레그램 실패:', e)


def dh(v):
    if not v:
        return ''
    parts = decode_header(v)
    return ''.join(t.decode(enc or 'utf-8', 'replace') if isinstance(t, bytes) else t
                   for t, enc in parts)


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(st):
    with open(STATE_FILE, 'w') as f:
        json.dump(st, f)


def connect():
    m = imaplib.IMAP4_SSL(HOST)
    m.login(USER, PASS)
    m.select('INBOX', readonly=True)
    return m


def max_uid(m):
    typ, data = m.uid('SEARCH', None, 'ALL')
    uids = data[0].split()
    return int(uids[-1]) if uids else 0


def new_matching(m, last_uid):
    """last_uid 이후 새 메일 중 전자소송 송달 알림에 해당하는 제목 목록과 새 max uid."""
    typ, data = m.uid('SEARCH', None, f'UID {last_uid + 1}:*')
    uids = [int(u) for u in data[0].split() if int(u) > last_uid]
    subjects = []
    for u in uids:
        typ, md = m.uid('FETCH', str(u), '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])')
        if not md or not md[0]:
            continue
        msg = email.message_from_bytes(md[0][1])
        frm, subj = dh(msg['From']), dh(msg['Subject'])
        if FROM_PAT.search(frm) and SUBJ_PAT.search(subj):
            subjects.append(subj)
            log('감지:', subj)
    return subjects, (max(uids) if uids else last_uid)


def run_handler():
    log('핸들러 실행:', HANDLER)
    try:
        r = subprocess.run([NODE, HANDLER], cwd=SKILL_DIR, timeout=600,
                           capture_output=True, text=True)
        log('핸들러 종료 코드', r.returncode)
        if r.stdout:
            log('stdout:', r.stdout[-2000:])
        if r.stderr:
            log('stderr:', r.stderr[-2000:])
    except subprocess.TimeoutExpired:
        log('핸들러 타임아웃(600s)')
        tg_send('❌ 전자소송 자동 점검이 10분 내에 끝나지 않아 중단되었습니다. 수동 확인 필요.')


def idle_wait(m, seconds):
    """IMAP IDLE로 새 이벤트 또는 타임아웃까지 대기. True=이벤트 발생."""
    tag = m._new_tag()
    m.send(tag + b' IDLE\r\n')
    resp = m.readline()
    if not resp.startswith(b'+'):
        raise imaplib.IMAP4.error('IDLE 거부: ' + resp.decode('utf-8', 'replace'))
    sock = m.socket()
    got_event = False
    deadline = time.time() + seconds
    try:
        while time.time() < deadline:
            remain = max(0.1, deadline - time.time())
            r, _, _ = select.select([sock], [], [], remain)
            if not r:
                break
            line = m.readline()
            if not line:
                raise imaplib.IMAP4.abort('연결 끊김')
            if b'EXISTS' in line:
                got_event = True
                break
    finally:
        m.send(b'DONE\r\n')
        # DONE 응답 소진
        while True:
            line = m.readline()
            if line.startswith(tag):
                break
    return got_event


def main():
    log('=== 전자소송 메일 감시 시작 ===', USER)
    st = load_state()
    while True:
        try:
            m = connect()
            if 'last_uid' not in st:
                st['last_uid'] = max_uid(m)
                save_state(st)
                log('초기 UID:', st['last_uid'], '(과거 메일은 처리하지 않음)')
            log('IMAP 연결됨. 감시 중...')
            while True:
                subjects, new_last = new_matching(m, st['last_uid'])
                if new_last != st['last_uid']:
                    st['last_uid'] = new_last
                    save_state(st)
                if subjects:
                    tg_send('📬 전자소송 새 송달 알림 감지\n' +
                            '\n'.join(f'• {s}' for s in subjects) +
                            f'\n\n{BATCH_WAIT}초 후 자동 점검을 시작합니다.')
                    time.sleep(BATCH_WAIT)
                    # 배칭: 대기 중 도착분도 소진
                    more, new_last = new_matching(m, st['last_uid'])
                    if new_last != st['last_uid']:
                        st['last_uid'] = new_last
                        save_state(st)
                    run_handler()
                idle_wait(m, IDLE_TIMEOUT)
        except (imaplib.IMAP4.abort, imaplib.IMAP4.error, socket.error,
                ssl.SSLError, OSError) as e:
            log('연결 오류, 60초 후 재접속:', e)
            time.sleep(60)
        except Exception as e:
            log('예기치 못한 오류, 120초 후 재시작:', repr(e))
            time.sleep(120)


if __name__ == '__main__':
    main()
