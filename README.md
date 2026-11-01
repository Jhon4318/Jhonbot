# Jhonbot — Bedrock Bot Console

Minecraft Bedrock Edition 向けの複数Bot管理デスクトップアプリです。Windows 11での利用を想定し、対象プロトコルは **Bedrock 1.26.60** です。

## 現在の配布版

**Prototype 0.3.5**

[0.3.5 ZIPをダウンロード](./Bedrock-Bot-Console-Prototype-0.3.5.zip)

1. ZIPを新しいフォルダーに展開します。
2. Windows 11で `start.bat` を実行します。
3. 初回起動時に依存パッケージがインストールされます。
4. アプリ内でBotを追加し、BotごとにMicrosoft/Xbox認証を行い、参加先を選択します。

必要環境: Windows 11 64-bit、Node.js 24以降（開発時の利用者環境はNode.js 26.13.0）。

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

0.3.5ではNetherNet HTTPのSDP送信前に構造診断を記録します。JWTの署名方式、公開鍵形式、指紋署名のローカル検証結果も記録しますが、候補IP/ポート、ICEパスワード、DTLS fingerprint値、JWT、署名、SDP本文などの秘密値は出力しません。ログ共有時もMicrosoftのパスワード、デバイスコード、アクセストークンを含めないでください。

## 開発者向け

リポジトリ直下にソースを展開しています。Node.js 24以降で次を実行します。

```powershell
npm install
npm run check
npm start
```

Windowsでは `start.bat` でも起動できます。`npm run check` はJavaScript構文と53件の単体テストを実行します。テスト成功は、実際のMicrosoft認証、The Hive接続、またはMinecraftワールド上でのスポーンを保証しません。

配布ZIP内の元READMEは `docs/README-0.3.5.md` に保存しています。GitHub Actionsの `validate.yml` はリポジトリ直下のソースに対して、Node.js 26で依存関係のインストールとテストを行います。
