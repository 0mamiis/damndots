#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo 'Updating Debian package metadata.'
apt-get update -qq
echo 'Installing the desktop runtime.'
apt-get install -y --no-install-recommends ca-certificates curl openssh-server xz-utils unzip procps iproute2 file less nano locales xvfb openbox tint2 picom feh xdotool scrot ffmpeg dbus-x11 xsettingsd x11-utils x11-xserver-utils xfce4-terminal thunar geany git python3 python3-pil python3-venv fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core adwaita-icon-theme libgl1-mesa-dri libglx-mesa0 libxcursor1 libxinerama1 libxrandr2 libxi6 libasound2t64 libfontconfig1 libegl1 libglu1-mesa libpulse0 libnss3 libxcomposite1 libxdamage1 libxkbcommon-x11-0 libxcb-xinerama0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxcb-shape0
echo 'Installing Debian desktop applications.'
apt-get install -y chromium chromium-l10n blender gimp inkscape kdenlive openscad kicad qgis paraview freecad drawing qgo gnugo libreoffice-writer libreoffice-calc libreoffice-draw
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
echo 'Installing VS Code.'
curl -fsSL https://update.code.visualstudio.com/latest/linux-deb-x64/stable -o /tmp/dots-code.deb
apt-get install -y /tmp/dots-code.deb
echo 'Installing Godot 4.6.3.'
curl -fsSL -L https://github.com/godotengine/godot/releases/download/4.6.3-stable/SHA512-SUMS.txt -o /tmp/godot-sums
curl -fsSL -L https://github.com/godotengine/godot/releases/download/4.6.3-stable/Godot_v4.6.3-stable_linux.x86_64.zip -o /tmp/godot.zip
(cd /tmp && awk '$2=="Godot_v4.6.3-stable_linux.x86_64.zip"{print $1"  "$2}' godot-sums > godot-check && test -s godot-check && cp godot.zip Godot_v4.6.3-stable_linux.x86_64.zip && sha512sum -c godot-check)
install -d /opt/godot
unzip -o -q /tmp/godot.zip -d /opt/godot
chmod 755 /opt/godot/Godot_v4.6.3-stable_linux.x86_64
ln -sf /opt/godot/Godot_v4.6.3-stable_linux.x86_64 /usr/local/bin/godot
curl -fsSL https://raw.githubusercontent.com/godotengine/godot/4.6.3-stable/icon.svg -o /usr/share/icons/hicolor/scalable/apps/godot.svg
echo 'Installing the matching Codex CLI.'
npm install --prefix /opt/dots-cli @openai/codex@0.159.2
ln -sf /opt/dots-cli/node_modules/.bin/codex /usr/local/bin/codex
install -d /run/sshd
ssh-keygen -A >/dev/null
install -d /etc/ssh/sshd_config.d
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
chown dot:dot /home/dot/.dots/installed
ln -sf /usr/share/zoneinfo/Europe/Istanbul /etc/localtime
apt-get clean
rm -f /tmp/dots-code.deb /tmp/godot.zip /tmp/Godot_v4.6.3-stable_linux.x86_64.zip /tmp/godot-sums /tmp/godot-check /tmp/dots-node-sha256 /tmp/node-v24.*-linux-x64.tar.xz
. /etc/os-release
echo "$PRETTY_NAME"
node --version
codex --version
blender --version | head -n 1
godot --version --headless 2>/dev/null | head -n 1 || true
chromium --version
echo 'Linux computer packages are installed.'
