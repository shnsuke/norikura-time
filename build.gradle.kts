// ルートプロジェクトにはプラグインを宣言しない。
// :app (Android Gradle Plugin) の解決には google() リポジトリへの到達が必要なため、
// :core (純Kotlin/JVMモジュール) だけを対象にビルド・テストする場合でも
// ルートのplugins{}でAGPを宣言してしまうと、AGP未使用時にも解決が走ってしまう。
// そのため各モジュールのbuild.gradle.ktsでそれぞれ必要なプラグインを宣言する。
