'use strict'

const SKIN_IMPORT_EXTENSIONS = Object.freeze(['png', 'json', 'bin', 'zip', 'mcpack'])

function skinImportChoiceOptions () {
  return {
    type: 'question',
    title: 'スキン素材を読み込む',
    message: '読み込み方法を選択してください。',
    detail: 'ファイルを選ぶ場合はPNG・JSON・BIN・ZIP・MCpackを複数選択できます。フォルダを選ぶ場合は、中にある対応ファイルをまとめて読み込みます。',
    buttons: ['ファイルを選択', 'フォルダを選択', 'キャンセル'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  }
}

function skinImportFileDialogOptions () {
  return {
    title: 'スキン素材ファイルを選択',
    buttonLabel: '読み込む',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Minecraft Skin / 4D Skin', extensions: [...SKIN_IMPORT_EXTENSIONS] },
      { name: 'すべてのファイル', extensions: ['*'] }
    ]
  }
}

function skinImportFolderDialogOptions () {
  return {
    title: 'スキン素材フォルダを選択',
    buttonLabel: 'このフォルダを読み込む',
    properties: ['openDirectory', 'multiSelections']
  }
}

module.exports = {
  SKIN_IMPORT_EXTENSIONS,
  skinImportChoiceOptions,
  skinImportFileDialogOptions,
  skinImportFolderDialogOptions
}
