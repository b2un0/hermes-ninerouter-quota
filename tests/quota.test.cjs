const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(`${__dirname}/../desktop/plugin.js`, 'utf8')
const logic = source.slice(source.indexOf('const pctOf'), source.indexOf('function fmtReset'))
const lowest = vm.runInNewContext(`${logic}\nlowest`)
const account = (...values) => ({ active: true, quotas: values.map(remainingPct => ({ remainingPct })) })

test('status bar uses remaining account instead of exhausted account', () => {
  assert.equal(lowest([account(0, 80), account(40, 60)]), 40)
})
test('all exhausted accounts show zero', () => {
  assert.equal(lowest([account(0), account(0, 50)]), 0)
})
test('usable accounts retain lowest quota', () => {
  assert.equal(lowest([account(70, 30), account(80)]), 30)
})
test('inactive accounts and unknown quotas are ignored', () => {
  assert.equal(lowest([{ ...account(0), active: false }, account(null), account(55)]), 55)
  assert.equal(lowest([]), null)
})
