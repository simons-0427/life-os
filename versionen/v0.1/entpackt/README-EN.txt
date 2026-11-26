Life OS v0.1 Beta

Life OS displays weight, calorie intake, activity, sleep and heart rate. Open API data → Quick entry to set goals and log daily values. The last weight and calorie goals apply until you save new ones. The API calculates deviations from your goals and sleep efficiency from the recorded stages.

The archive includes a Windows client, Android source code and a self-hosted API. A new installation starts with an empty database. The apps work with the API alone.

1. Set up the API on your domain

   You need HTTPS, PHP 8.1 or newer with OpenSSL and PDO MySQL, and MySQL or MariaDB.

   a) Create an empty database with a dedicated user and import server/private/schema.sql.
   b) Open server/Schluessel-erzeugen.html locally and click “Neue Schlüssel erzeugen”. Store the generated read, write and encryption keys securely. Run the SQL shown on that page in the same database.
   c) Put server/private outside the document root at private/gymprogress-api. Copy config.example.php to config.php there, then fill in the database connection and encryption key.
   d) Copy the contents of server/public into the document root. The base URL will look like https://api.example.org/api/gymprogress/v1. For a different layout, set GYMPROGRESS_API_BOOTSTRAP to the absolute path of the private bootstrap.php.
   e) Open /health.php at the base URL and check for a status of “ok”. A request to /data.php without an API key should return HTTP 401. Check that config.php cannot be reached from the web.

   If TLS terminates at a reverse proxy, configure PHP to recognise HTTPS from a trusted proxy. The host must run PHP and connect to the database. GitHub Pages alone cannot run the API.

2. Connect Windows

   Install Python 3.11 or newer and Edge, Chrome or Brave. Run windows/Life OS starten.bat. In the app, open Einstellungen → API-Verbindung. Enter the HTTPS base URL without a file name, select “GymProgress-kompatibel” and set the first day to fetch. Use a read key for viewing or add a write key for editing. The beta stores its connection separately in your Windows profile.

3. Connect Android

   Open the android folder in Android Studio with JDK 17 and Android SDK API 36. Use Run to build and install on a connected device. For a local test APK, run gradlew.bat :app:assembleDebug. The file is built under android/app/build/outputs/apk/debug/.

   Open Einstellungen → API-Verbindung, enter the same base URL and paste the write key. Enable “Health Connect für diese Verbindung verwenden”. Open Health Connect from the app and grant access. Run a manual sync first and check the records under API-Daten → Originalwerte. Minimum heart rate requires recorded heart-rate measurements. The date range depends on the data and permissions available in Health Connect.

4. Move to another URL

   Update the HTTPS base URL and keys in both apps. When moving an existing server, transfer the database and keep its encryption key. Store the key and backups outside the public directory. The API uses calendar days in Europe/Berlin.

   For an existing JSON API, choose “JSON-API mit Feldzuordnung” and configure the list path, date, namespace, metric and value fields. Add authentication and write routes if needed. Health Connect and the bundled server calculations use the GymProgress-compatible format.
