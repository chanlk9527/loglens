'use strict';
// Never invoke the packaging tool on the protected workstation.
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  console.error('本机打包已停用：请通过 GitHub Actions 的 Desktop build 工作流构建。');
  process.exitCode = 1;
} else {
  const {build, Platform, Arch} = require('electron-builder');
  const target = process.argv[2];
  const targets = target === 'win' ? Platform.WINDOWS.createTarget(['portable'], Arch.x64) : target === 'mac' ? Platform.MAC.createTarget(['dmg'], Arch.arm64, Arch.x64) : undefined;
  if (!targets) throw Error('Choose win or mac in the CI build');
  build({targets, publish: 'never'}).catch(error => { console.error(error.message); process.exitCode = 1; });
}
