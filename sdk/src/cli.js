import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { exec } from 'mz/child_process';
import eventToPromise from 'event-to-promise';

import API from './api';

const SILK_SCRIPT_BUILD = 'silk-build';

let _pkgRoot = null;
function findPackageRoot() {
  if (_pkgRoot) {
    return _pkgRoot;
  }

  let curPath = process.cwd();
  let curName = path.join(curPath, 'package.json');

  while (!fs.existsSync(curName)) {
    if (curPath === '/') {
      throw new Error(`Could not locate 'package.json' file. Ensure you're running this command inside a Silk extension project.`);
    }
    curPath = path.dirname(curPath);
    curName = path.join(curPath, 'package.json');
  }

  _pkgRoot = curPath;
  return _pkgRoot;
}

function sourceArg() {
  return [['source'], {
   help: `Source of the files `,
   type: (value) => path.resolve(value),
 }];
}

function printDevices(devices) {
  for (let device of devices) {
    console.log(`${device.serial}\t(state = ${device.state})`);
  }
}

async function checkDevices(api, device) {
  const devices = await api.listDevices();
  if (!devices.length) {
    console.error(`No devices online`);
    process.exit(1);
  }

  if (!device && devices.length > 1) {
    console.error(`More than one device connected. Please pass --device\n`);
    console.error(`Use one of the following devices:`);
    printDevices(devices);
    process.exit(1);
  }
}

/**
 * This function is run from every cli call to ensure the enviornment is
 * correctly setup.
 */
function ensureSetup(argv) {
  const root = findPackageRoot();
  const emulatorBin = path.join(root, 'node_modules/silk-sdk-emulator/vendor/bin');

  // Additional paths to search for outside of PATH.
  const additionalPaths = [];

  if (fs.existsSync(emulatorBin)) {
    additionalPaths.push(emulatorBin);
  }

  argv.arguments = argv.arguments || [];
  argv.arguments = [
    [['--device', '-d'], {
      help: 'Specific device to operate under.'
    }],
    ...argv.arguments,
  ];

  const main = argv.main;
  argv.main = function (args) {
    const {device} = args;
    const api = new API({
      device: device,
      additionalPaths: additionalPaths,
    });

    return main(api, args);
  };

  return argv;
}

async function runBuild(pkg, cmd, dest) {
  const buildEnv = {};
  for (let key in process.env) {
    buildEnv[key] = process.env[key];
  }

  buildEnv.SILK_OUT = dest;
  // TODO: This would be good place to boostrap the system to handle things like
  // building native modules.

  console.log(' > silk-build: ', cmd);
  const proc = spawn('/bin/bash', ['-c', cmd], {
    env: buildEnv,
    stdio: 'inherit',
  });

  const exitCode = await eventToPromise(proc, 'exit');
  if (exitCode !== 0) {
    console.error(`Your project has failed to build.`);
    process.exit(1);
  }
}

async function silkBuild(pkg, dest) {
  if (pkg.scripts && pkg.scripts[SILK_SCRIPT_BUILD]) {
    await runBuild(pkg, pkg.scripts[SILK_SCRIPT_BUILD]);
  }
}

export let devices = ensureSetup({
  help: `List the devices available (NOTE: This includes non silk devices).`,
  main: async (api, args) => {
    const devices = await api.listDevices();
    if (devices.length === 0) {
      console.log(`No devices available`);
      return;
    }

    console.log('Available devices:\n');
    printDevices(devices);
  },
});

/**
 * Run and tail the extension.
 */
export let run = ensureSetup({
  help: 'Run the extension on device.',
  arguments: [
    sourceArg(),
  ],
  main: async (api, args) => {
    await checkDevices(api, args.device);
    const pkg = require(path.join(findPackageRoot(), 'package.json'));
    await silkBuild(pkg, args.source);
    await api.pushModule(pkg.name, args.source);
    await api.activate(pkg.name);
    await api.restart();
    const logcat = api.logcat(['-T1']);
    logcat.stdout.pipe(process.stdout);
    logcat.stderr.pipe(process.stdout);
  },
});

export let build = ensureSetup({
  help: `Run the silk build script without pushing`,
  arguments: [
    sourceArg(),
  ],
  main: async (api, args) => {
    const pkg = require(path.join(findPackageRoot(), 'package.json'));
    await silkBuild(pkg, args.source);
  }
});

export let push = ensureSetup({
  help: `Push files without restarting the process`,
  arguments: [
    sourceArg(),
  ],
  main: async (api, args) => {
    await checkDevices(api, args.device);
    const pkg = require(path.join(findPackageRoot(), 'package.json'));
    await api.pushModule(pkg.name, args.source);
  }
});

export let activate = ensureSetup({
  help: `Activate given (mark it as main module)`,
  main: async (api, args) => {
    await checkDevices(api);
    const pkg = require(path.join(findPackageRoot(), 'package.json'));
    await api.activate(pkg.name);
  }
});


export let restart = ensureSetup({
  help: `Restart silk device or emulator`,
  main: async (api, args) => {
    await api.restart();
  }
});

export let log = ensureSetup({
  help: `Begin tailing log of silk device or emulator`,
  arguments: [
    [['--recent', '-r'], {
      action: 'storeTrue',
      help: `Start tailing from current place in log`
    }]
  ],
  main: async (api, args) => {
    const logcatArgs = [];
    if (args.recent) {
      logcatArgs.push('-T1');
    }

    const logcat = api.logcat(logcatArgs);
    logcat.stdout.pipe(process.stdout);
    logcat.stderr.pipe(process.stdout);
  }
});
