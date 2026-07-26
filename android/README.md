# Ковчег для Android

Нативная Android-оболочка загружает приложение с
`https://federation-of-kovcheg.tech`. Изменения интерфейса и игровой логики,
развёрнутые на сервере, становятся доступны без выпуска нового APK.

## Сборка

Требуются JDK 17, Android SDK 35 и Gradle Wrapper.

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew assembleDebug
```

Для релизной сборки создайте `signing.properties` (файл исключён из Git):

```properties
storeFile=/absolute/path/to/kovcheg-release.jks
storePassword=...
keyAlias=kovcheg
keyPassword=...
```

После этого:

```sh
./gradlew assembleRelease
```
