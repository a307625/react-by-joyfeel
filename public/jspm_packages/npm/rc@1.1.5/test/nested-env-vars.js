/* */ 
(function(process) {
  var n = 'rc' + Math.random();
  var assert = require('assert');
  process.env[n + '_someOpt__a'] = 42;
  process.env[n + '_someOpt__x__'] = 99;
  process.env[n + '_someOpt__a__b'] = 186;
  process.env[n + '_someOpt__a__b__c'] = 243;
  process.env[n + '_someOpt__x__y'] = 1862;
  process.env[n + '_someOpt__z'] = 186577;
  process.env[n + '_someOpt__z__x__'] = 18629;
  process.env[n + '_someOpt__w__w__'] = 18629;
  process.env[n + '___z__i__'] = 9999;
  var config = require('../index')(n, {option: true});
  console.log('\n\n------ nested-env-vars ------\n', config);
  assert.equal(config.option, true);
  assert.equal(config.someOpt.a, 42);
  assert.equal(config.someOpt.x, 99);
  assert.equal(config.someOpt.a, 42);
  assert.equal(config.someOpt.x, 99);
  assert.equal(config.someOpt.z, 186577);
  assert.equal(config.someOpt.z, 186577);
  assert.equal(config.someOpt.w.w, 18629);
  assert.equal(config.z.i, 9999);
})(require('process'));
