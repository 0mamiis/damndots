# Third-party components

The MIT license in this repository applies to this project's own source. npm dependencies retain their own licenses; their names, versions and license metadata are in `package-lock.json` and their installed packages.

OpenAI Codex and the desktop application's code, assets and account services are separate products. This source distribution contains no Codex executable, extracted ASAR, proprietary webview bundle, avatar library, account token or cloud computer image. Native compatibility tests can optionally read assets from a tester's own installation using `DOTS_NATIVE_TEST_ASSETS`; these assets must not be committed or packaged.

Linux setup downloads Debian, Node.js, Codex CLI and desktop applications from their respective distribution sites. Those components are installed separately and keep their respective licenses. The desktop start page and theme in this project are locally implemented; they are not OpenAI's original desktop image or theme.

This is an independent community project and is not affiliated with or endorsed by OpenAI. Codex and other product names belong to their respective owners.
