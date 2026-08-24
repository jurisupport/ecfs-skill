"""k-skill 공용 자격증명 로더 (Python)

우선순위: 환경변수 → sops 금고(~/.config/k-skill/secrets.env)
소스코드에 비밀번호를 하드코딩하지 말 것. 값은 금고에만 둔다.

사용:
    from k_secrets import secret
    PASS = secret('GMAIL_APP_PW')            # 없으면 RuntimeError
    cid  = secret('TELEGRAM_CHAT_ID', None)  # 없으면 None

금고 편집:
    cd ~/.config/k-skill
    SOPS_AGE_KEY_FILE=age/keys.txt sops secrets.env
"""

import os
import re
import shutil
import subprocess

CFG_DIR = os.path.expanduser('~/.config/k-skill')
VAULT = os.path.join(CFG_DIR, 'secrets.env')
SOPS_CFG = os.path.join(CFG_DIR, '.sops.yaml')
AGE_KEY = os.path.join(CFG_DIR, 'age/keys.txt')

_cache = None
_MISSING = object()


def _load_vault():
    global _cache
    if _cache is not None:
        return _cache
    _cache = {}
    if not os.path.exists(VAULT):
        return _cache
    env = dict(os.environ)
    if os.path.exists(AGE_KEY):
        env.setdefault('SOPS_AGE_KEY_FILE', AGE_KEY)
    sops = shutil.which('sops') or next(
        (c for c in ('/opt/homebrew/bin/sops', '/usr/local/bin/sops', '/usr/bin/sops')
         if os.path.exists(c)), None)
    if not sops:
        return _cache
    args = [sops]
    if os.path.exists(SOPS_CFG):
        args += ['--config', SOPS_CFG]
    args += ['--decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', VAULT]
    try:
        out = subprocess.run(args, env=env, capture_output=True, text=True, timeout=30)
        if out.returncode == 0:
            for line in out.stdout.splitlines():
                m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line)
                if m:
                    _cache[m.group(1)] = m.group(2)
    except (OSError, subprocess.SubprocessError):
        pass  # sops 미설치 등 → 환경변수만으로 동작 시도
    return _cache


def secret(key, default=_MISSING):
    v = os.environ.get(key)
    if v:
        return v
    v = _load_vault().get(key)
    if v:
        return v
    if default is not _MISSING:
        return default
    raise RuntimeError(
        "자격증명 '%s' 없음. 환경변수로 주거나 금고에 넣을 것:\n"
        "  cd ~/.config/k-skill && SOPS_AGE_KEY_FILE=age/keys.txt sops secrets.env" % key
    )
