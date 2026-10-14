#!/usr/bin/env python3
"""Flatten official images locally for Docker vfs; never push derived images."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import urllib.request


def run(args):
    return subprocess.check_output(args, text=True).strip()


if run(['docker', 'info', '--format', '{{.Driver}}']) != 'vfs':
    print('Docker does not need the vfs workaround.')
    raise SystemExit(0)

root = Path('/workspace/.tools/gregslist')
root.mkdir(parents=True, exist_ok=True)
crane = root / 'crane'
if not crane.exists():
    version = 'v0.20.6'
    base = f'https://github.com/google/go-containerregistry/releases/download/{version}/'
    with tempfile.TemporaryDirectory(prefix='gregslist-crane-') as tmp:
        archive = Path(tmp) / 'crane.tar.gz'
        urllib.request.urlretrieve(base + 'go-containerregistry_Linux_x86_64.tar.gz', archive)
        checksums = urllib.request.urlopen(base + 'checksums.txt').read().decode()
        expected = next(line.split()[0] for line in checksums.splitlines() if line.endswith('go-containerregistry_Linux_x86_64.tar.gz'))
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, 'Release checksum mismatch'
        with tarfile.open(archive) as tar:
            tar.extract('crane', root, filter='data')

images = ['postgres:17.11.0.004', 'storage-api:v1.79.36']
for image in images:
    target = 'ghcr.io/supabase/' + image
    if subprocess.run(['docker', 'image', 'inspect', target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        print(f'{image}: already cached')
        continue
    digest = run([str(crane), 'digest', '--platform', 'linux/amd64', target])
    source = target.split(':')[0] + '@' + digest
    config = json.loads(run([str(crane), 'config', source]))['config']
    with tempfile.TemporaryDirectory(prefix='gregslist-image-') as tmp:
        archive = str(Path(tmp) / 'rootfs.tar')
        # crane verifies registry layer digests during export; TLS stays enabled.
        subprocess.run([str(crane), 'export', source, archive], check=True)
        args = ['docker', 'import']
        for item in config.get('Env', []):
            key, value = item.split('=', 1)
            value = value.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$')
            args += ['--change', f'ENV {key}="{value}"']
        for key in ['Entrypoint', 'Cmd']:
            if config.get(key):
                args += ['--change', key.upper() + ' ' + json.dumps(config[key])]
        for key, instruction in [('WorkingDir', 'WORKDIR'), ('User', 'USER'), ('StopSignal', 'STOPSIGNAL')]:
            if config.get(key):
                args += ['--change', instruction + ' ' + config[key]]
        for port in config.get('ExposedPorts', {}):
            args += ['--change', 'EXPOSE ' + port]
        if config.get('Volumes'):
            args += ['--change', 'VOLUME ' + json.dumps(list(config['Volumes']))]
        health = config.get('Healthcheck', {})
        if health.get('Test'):
            instruction = 'HEALTHCHECK '
            for key in ['Interval', 'Timeout', 'StartPeriod']:
                if health.get(key):
                    flag = {'Interval': 'interval', 'Timeout': 'timeout', 'StartPeriod': 'start-period'}[key]
                    instruction += f'--{flag}={health[key]}ns '
            if health.get('Retries'):
                instruction += f'--retries={health["Retries"]} '
            kind, *test = health['Test']
            instruction += 'NONE' if kind == 'NONE' else 'CMD ' + (' '.join(test) if kind == 'CMD-SHELL' else json.dumps(test))
            args += ['--change', instruction]
        args += ['--change', f'LABEL org.gregslist.source-digest={digest}', archive, target]
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL)
    print(f'{image}: verified official filesystem imported as one local layer')
