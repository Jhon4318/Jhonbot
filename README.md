# Jhonbot — Bedrock Bot Console

Minecraft Bedrock Edition 向けの複数Bot管理デスクトップアプリです。Windows 11での利用を想定し、対象プロトコルは **Bedrock 1.26.60** です。

## 配布版

**Prototype 0.4.1**

[最新版のWindows配布ページ（Setup.exe / 手動更新ZIP）](https://github.com/Jhon4318/Jhonbot/releases/latest)

### 更新方法

既存インストールの更新も、Releaseページから最新版の `Bedrock-Bot-Console-Setup.exe` をダウンロードして実行してください。通常の上書きインストールで、Bot一覧・接続先・設定・保存済み認証情報は維持されます。

手動更新ZIPは、Windowsの展開先パス長制限に関する修正が完了するまで使用しないでください。

## 初回インストール

初めて利用する場合、または手動更新ZIPの適用対象外になった場合はReleaseページの `Bedrock-Bot-Console-Setup.exe` を実行してください。現在のWindowsユーザー用にインストールされ、通常は管理者権限を必要としません。デスクトップまたはスタートメニューの「Bedrock Bot Console」から起動できます。

## 主な機能

- Botを複数登録し、Botごとに認証・参加先を管理
- Microsoft/Xboxアカウント認証とワールド参加を別操作に分離
- 公開サーバーの接続プロファイルを共通管理
- 公開サーバー、フレンドのワールド、LANワールドをBotごとに選択
- RakNet / NetherNet LAN / NetherNet HTTP の接続方式
- サーバー公開鍵の初回確認とフィンガープリント固定
- 移動操作、座標指定の経路探索（利用可能なチャンク情報に依存）

## 現在の制限・未確認事項

- The Hiveへのオンライン接続は未解決です。HTTPSのシグナリングエンドポイントが応答することは確認しましたが、NetherNet HTTPのPOSTは400を返しており、参加成功は確認できていません。
- NetherNet HTTP対応の依存ライブラリは上流未マージの開発コミットに固定されています。
- Bedrock 1.26.60での実ワールド参加・スポーン・移動は利用環境での確認が必要です。
- LAN検索での複数広告一覧、Realms一覧、採掘・設置・インベントリ操作は未実装です。

接続テストを行う場合は、The Hiveのアカウント規約・サーバールールを守ってください。Bot利用が禁止されている場所では使用しないでください。

## 診断ログとプライバシー

0.3.7ではNetherNet HTTPのSDP送信前に構造診断を記録します。SDP送信前に、共通のDTLS fingerprintがメディア領域にしかない場合はセッション領域へ移動し、fingerprintをa=identityより前に配置します。異なるfingerprintが複数ある場合はSDPの意味を変えないよう自動変更しません。JWTヘッダーの署名アルゴリズム・audクレーム、公開鍵形式、cpkを使ったDTLS指紋署名のローカル検証結果も記録します。JWT自体のMicrosoft署名検証は行わず、これらは送信内容の整合性診断です。候補IP/ポート、ICEパスワード、DTLS fingerprint値、JWT、署名、SDP本文などの秘密値は出力しません。ログ共有時もMicrosoftのパスワード、デバイスコード、アクセストークンを含めないでください。

## 開発者向け

通常の利用者はReleaseページの配布ファイルを使ってください。ソースから開発する場合は、Node.js 24以降でリポジトリ直下から次を実行します。

```powershell
npm install
npm run check
npm start
```

Windows向けインストーラーを手元でビルドする場合は `npm run dist:win` を実行します。開発用の `start.bat` はソース実行時にのみ使用します。

`npm run check` はJavaScript構文、インストーラー設定、単体テストに加え、Mineflayer / Bedrock Protocolの実行時依存関係が読み込めることを確認します。CIではWindows x64のNSISインストーラーと手動更新ZIPを生成し、GitHub Releasesへ添付します。自動テストとビルド成功は、実際のMicrosoft認証、The Hive接続、またはMinecraftワールド上でのスポーンを保証しません。
