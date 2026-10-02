#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo 'Updating Ubuntu package metadata.'
apt-get update -qq
echo 'Installing the desktop runtime and applications.'
apt-get install -y --no-install-recommends ca-certificates curl sudo openssh-server xvfb openbox tint2 picom feh xdotool scrot ffmpeg dbus-x11 xsettingsd x11-utils x11-xserver-utils xfce4-terminal thunar geany git python3 python3-pil python3-venv fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core locales adwaita-icon-theme libgl1-mesa-dri blender gimp inkscape kdenlive godot3 openscad kicad qgis paraview libreoffice-draw libreoffice-writer libreoffice-calc drawing qgo gnugo
if ! id dot >/dev/null 2>&1; then useradd --create-home --shell /bin/bash dot; fi
usermod -aG audio,video dot
install -d -m 700 -o dot -g dot /home/dot/.dots /home/dot/.ssh
install -d -m 755 -o dot -g dot /home/dot/Workspace /home/dot/Downloads /home/dot/.local/share/applications
printf 'en_US.UTF-8 UTF-8\ntr_TR.UTF-8 UTF-8\n' >/etc/locale.gen
locale-gen >/dev/null
echo 'Installing the Linux Node runtime.'
curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o /tmp/dots-node-sha256
node_archive=$(awk '$2 ~ /^node-v24\..*-linux-x64\.tar\.xz$/ {print $2; exit}' /tmp/dots-node-sha256)
test -n "$node_archive"
curl -fsSL "https://nodejs.org/dist/latest-v24.x/$node_archive" -o "/tmp/$node_archive"
(cd /tmp && grep " $node_archive$" dots-node-sha256 | sha256sum -c -)
install -d /opt/dots-node
tar -xJf "/tmp/$node_archive" -C /opt/dots-node --strip-components=1
ln -sf /opt/dots-node/bin/node /usr/local/bin/node
ln -sf /opt/dots-node/bin/npm /usr/local/bin/npm
ln -sf /opt/dots-node/bin/npx /usr/local/bin/npx
echo 'Installing the browser and VS Code.'
curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/dots-chrome.deb
apt-get install -y /tmp/dots-chrome.deb
curl -fsSL https://update.code.visualstudio.com/latest/linux-deb-x64/stable -o /tmp/dots-code.deb
apt-get install -y /tmp/dots-code.deb
echo 'Installing the matching Codex CLI.'
npm install --prefix /opt/dots-cli @openai/codex@0.159.2
ln -sf /opt/dots-cli/node_modules/.bin/codex /usr/local/bin/codex
install -d /run/sshd
ssh-keygen -A >/dev/null
cat >/etc/ssh/sshd_config.d/dots.conf <<'EOF'
Port 22444
ListenAddress 127.0.0.1
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers dot
AllowTcpForwarding remote
GatewayPorts no
AllowAgentForwarding no
X11Forwarding no
EOF
cat >/etc/wsl.conf <<'EOF'
[automount]
enabled=false
[interop]
enabled=false
appendWindowsPath=false
[user]
default=dot
EOF
touch /home/dot/.dots/installed
ln -sf /usr/share/zoneinfo/Europe/Istanbul /etc/localtime
chown dot:dot /home/dot/.dots/installed
node --version
codex --version
blender --version | head -n 1
echo 'Linux computer packages are installed.'
