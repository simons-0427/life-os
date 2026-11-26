Life OS v0.1 Beta

Life OS zeigt Gewicht, Kalorien, Aktivität, Schlaf und Puls in einer Tagesübersicht. Unter API-Daten → Schnelleingabe lassen sich Ziele und Tageswerte eintragen. Das letzte Gewichts- und Kalorienziel gilt weiter, bis du ein neues speicherst. Die API berechnet Gewichts- und Kalorienabweichung sowie die Schlafeffizienz aus den gespeicherten Messwerten.

Das ZIP enthält den Windows-Client, den Android-Quellcode und die API für einen eigenen Server. Die Datenbank ist nach der Einrichtung leer. Du brauchst keine Excel-Datei.

1. API auf deiner Domain einrichten

   Voraussetzungen sind ein Webserver mit HTTPS, PHP ab 8.1 mit OpenSSL und PDO MySQL sowie eine MySQL- oder MariaDB-Datenbank.

   a) Lege eine leere Datenbank an und importiere server/private/schema.sql. Richte dafür einen eigenen Datenbankbenutzer ein.
   b) Öffne server/Schluessel-erzeugen.html lokal im Browser und klicke auf „Neue Schlüssel erzeugen“. Lege die beiden API-Schlüssel und den Verschlüsselungsschlüssel sicher ab. Importiere das angezeigte SQL in dieselbe Datenbank.
   c) Kopiere server/private außerhalb des öffentlichen Webordners nach private/gymprogress-api. Kopiere dort config.example.php nach config.php und trage Datenbank-Host, Datenbankname, Benutzer, Passwort und den erzeugten Verschlüsselungsschlüssel ein.
   d) Kopiere den Inhalt von server/public in den öffentlichen Webordner. Die Basisadresse lautet dann zum Beispiel https://api.example.org/api/gymprogress/v1. Bei einer anderen Ordner- oder Serverstruktur kannst du GYMPROGRESS_API_BOOTSTRAP auf den absoluten Pfad zu deiner privaten bootstrap.php setzen.
   e) Öffne /health.php an deiner Basisadresse. Die Antwort muss „status“: „ok“ enthalten. /data.php muss ohne API-Schlüssel HTTP 401 liefern. Prüfe, dass config.php von außen unerreichbar ist.

   Wenn dein Server HTTPS hinter einem Reverse Proxy beendet, richte PHP so ein, dass es vertrauenswürdig erkennt, ob die Anfrage über HTTPS kam. Dateiablage, PHP-Ausführung und Datenbank müssen auf dem eigenen Hosting verfügbar sein. GitHub Pages allein führt die PHP-Dateien nicht aus.

2. Windows verbinden

   Installiere Python 3.11 oder neuer sowie Edge, Chrome oder Brave. Starte windows/Life OS starten.bat. Trage unter Einstellungen → API-Verbindung deine HTTPS-Basisadresse ohne Dateinamen ein. Wähle „GymProgress-kompatibel“ und setze das erste Abrufdatum. Zum Lesen genügt der Leseschlüssel. Für die Schnelleingabe brauchst du den Schreibschlüssel. Die Beta speichert ihre Verbindung getrennt von anderen Installationen im Windows-Benutzerprofil.

3. Android verbinden

   Öffne den Ordner android in Android Studio. Du brauchst JDK 17 und das Android SDK für API 36. Android Studio lädt beim ersten Build die Gradle-Abhängigkeiten. Über den Run-Button installierst du die App auf einem verbundenen Gerät. Der Befehl gradlew.bat :app:assembleDebug baut zum lokalen Testen eine APK unter android/app/build/outputs/apk/debug/.

   Trage in der App unter Einstellungen → API-Verbindung dieselbe Basisadresse und den Schreibschlüssel ein. Aktiviere „Health Connect für diese Verbindung verwenden“. Öffne Health Connect aus der App und erteile die Leserechte. Synchronisiere zuerst manuell und kontrolliere unter API-Daten → Originalwerte, ob Messwerte ankommen. Der Mindestpuls braucht aufgezeichnete Pulsmessungen. Wie weit die App dabei zurücklesen kann, hängt von den gespeicherten Daten und den erteilten Rechten ab.

4. Betrieb und Wechsel auf eine andere URL

   Hinterlege die neue HTTPS-Basisadresse in beiden Apps. Nutze die Schlüssel der API, die an dieser Adresse läuft. Wenn du einen bestehenden Server umziehst, sichere und übertrage die Datenbank zusammen mit ihrem Verschlüsselungsschlüssel. Bewahre Schlüssel und Datenbank-Backups außerhalb des öffentlichen Webordners auf. Die API verwendet Kalendertage in der Zeitzone Europe/Berlin.

   Eine vorhandene JSON-API lässt sich im Modus „JSON-API mit Feldzuordnung“ lesen. Setze den Pfad zur Liste, die Felder für Datum, Datenbereich, Messwert und Wert sowie bei Bedarf Authentifizierung und Schreibpfade. Health Connect und die PHP-Berechnungen in dieser Beta verwenden das mitgelieferte GymProgress-kompatible Format.
