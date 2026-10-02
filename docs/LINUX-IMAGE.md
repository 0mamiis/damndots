# Prepared Linux image

The `linux-v0.1` release contains a sanitized Debian 13 WSL2 rootfs with the desktop applications already installed. It is provided as a split `.tar.gz`, a manifest, SHA256 checksums, a package inventory, source retrieval information and notices.

Use a current checkout with `scripts/download-linux-image.mjs`. It downloads from the fixed `0mamiis/damndots` release, verifies every part and the assembled image, and prints the archive path and hash. Pass these to the dashboard custom-image form or `DOTS_LINUX_IMAGE` and `DOTS_LINUX_IMAGE_SHA256` before running setup.

WSL2 must already be installed. The rootfs is not a bootable ISO. Source files, Chromium profiles, Dot messages/memories, work files, host SSH keys and access tokens from the original installation are excluded. The image contains locked generic Linux user accounts, not build-machine password hashes.

Prepared-image setup initializes private directories and new SSH host keys, obtains Microsoft VS Code from Microsoft and syncs the worker source/dependencies from the user's checkout. Those steps still need internet access. The main Windows Codex account is not included or modified.

The release's package/source catalogue identifies the unmodified Debian source package and exact source version for each installed binary package. Copyright notices remain under `/usr/share/doc`, and common license texts under `/usr/share/common-licenses`. Source retrieval instructions and upstream links for separately installed components are also included. The image is not licensed as a whole under the project's MIT license.

Source code changes use protected-branch pull requests. The Linux binary image has a separate `linux-v0.1` release tag; it does not replace the `v0.1` project source release.
