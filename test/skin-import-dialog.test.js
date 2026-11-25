'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  SKIN_IMPORT_EXTENSIONS,
  skinImportChoiceOptions,
  skinImportFileDialogOptions,
  skinImportFolderDialogOptions
} = require('../src/skin-import-dialog')

test('skin import lets the user choose file selection or folder selection explicitly', () => {
  const choice = skinImportChoiceOptions()
  assert.deepEqual(choice.buttons, ['ファイルを選択', 'フォルダを選択', 'キャンセル'])
  assert.equal(choice.defaultId, 0)
  assert.equal(choice.cancelId, 2)
})

test('file picker accepts multiple supported skin files without opening a folder picker', () => {
  const options = skinImportFileDialogOptions()
  assert.deepEqual(options.properties, ['openFile', 'multiSelections'])
  assert.deepEqual(options.filters[0].extensions, [...SKIN_IMPORT_EXTENSIONS])
  assert.ok(options.filters.some(filter => filter.extensions.includes('*')))
  assert.equal(options.properties.includes('openDirectory'), false)
})

test('folder picker selects directories only and supports multiple folders', () => {
  const options = skinImportFolderDialogOptions()
  assert.deepEqual(options.properties, ['openDirectory', 'multiSelections'])
  assert.equal(options.properties.includes('openFile'), false)
})
