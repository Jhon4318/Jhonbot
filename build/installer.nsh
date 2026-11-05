; Migration for installations created before v0.4.3.
; Older packages accidentally included Jest's disposable transform cache in
; app.asar.unpacked. Its hashed filenames can exceed NSIS's MAX_PATH limit,
; causing the old uninstaller to report that the app cannot be closed.
;
; Move only that disposable cache directory to a short path before the old
; uninstaller runs. This leaves app files and all user data untouched.
;
; Use NSIS registers rather than custom variables: electron-builder's NSIS
; compiler treats the customInit macro's source variable as unused in some
; builds and promotes warning 6001 to a fatal error.

!macro customInit
  StrCpy $R0 "$INSTDIR\resources\app.asar.unpacked\node_modules\@shinyoshiaki\binary-data\.jest-cache"
  IfFileExists "$R0\*.*" jhonbotLegacyCacheFound jhonbotLegacyCacheDone

  jhonbotLegacyCacheFound:
    CreateDirectory "$LOCALAPPDATA\Temp"
    GetTempFileName $R1 "$LOCALAPPDATA\Temp"
    Delete "$R1"
    ClearErrors
    Rename "$R0" "$R1"
    IfErrors jhonbotLegacyCacheMoveFailed

    ; The staging path is short enough for NSIS to remove recursively.
    ClearErrors
    RMDir /r "$R1"
    IfErrors jhonbotLegacyCacheDeleteFailed
    Goto jhonbotLegacyCacheDone

  jhonbotLegacyCacheMoveFailed:
    MessageBox MB_OK|MB_ICONSTOP "旧版の不要なテストキャッシュを一時フォルダーへ移動できませんでした。アプリを終了し、空き容量とフォルダーのアクセス権を確認してから再実行してください。"
    Abort

  jhonbotLegacyCacheDeleteFailed:
    ; The long path is already outside the installation directory. Leaving
    ; this small disposable cache in Temp does not block the upgrade.
    DetailPrint "The legacy Jest cache was moved but could not be deleted: $R1"
    MessageBox MB_OK|MB_ICONEXCLAMATION "旧版の不要なテストキャッシュは退避しましたが、一時フォルダー内の削除は完了しませんでした。更新は続行します。"

  jhonbotLegacyCacheDone:
!macroend
