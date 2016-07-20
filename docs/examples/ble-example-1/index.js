'use strict';

const log = require('silk-alog');

let device = require('./device');

/**
 * Initializing all the necessary modules.
 */
device.init();

/**
 * TODO: Put your stuff here...
 */
const noble = require('noble');

noble.on('stateChange', (state) => {
  if (state === 'poweredOn') {
    noble.startScanning();
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', (peripheral) => {
  log.info('Device ID: ' + peripheral.id);
  log.info('Device address: ' + peripheral.address);
  log.info('Device name: ' + peripheral.advertisement.localName);
});
