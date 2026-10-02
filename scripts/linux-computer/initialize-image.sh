#!/usr/bin/env bash
set -euo pipefail
test -f /usr/local/share/damndots-image/image.json
test "$(. /etc/os-release; echo "$ID:$VERSION_ID")" = 'debian:13'
id dot >/dev/null
install -d -m 700 -o dot -g dot /home/dot /home/dot/.dots /home/dot/.ssh
install -d -m 755 -o dot -g dot /home/dot/Workspace /home/dot/Downloads /home/dot/.local/share/applications
install -d -m 1777 /tmp /var/tmp
install -d -m 755 /run/sshd /var/log /var/cache /var/lib/dbus
if ! test -s /etc/machine-id; then dbus-uuidgen --ensure=/etc/machine-id; fi
ln -sf /etc/machine-id /var/lib/dbus/machine-id
ssh-keygen -A >/dev/null
# Original Microsoft VS Code binaries are not redistributed in the image.
if ! command -v code >/dev/null 2>&1; then
  echo 'Installing VS Code from Microsoft.'
  curl -fsSL https://update.code.visualstudio.com/latest/linux-deb-x64/stable -o /tmp/damndots-code.deb
  DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/damndots-code.deb
  rm -f /tmp/damndots-code.deb
fi
touch /home/dot/.dots/installed
chown dot:dot /home/dot/.dots/installed
echo 'Ready image initialized with this installation’s own host keys.'
