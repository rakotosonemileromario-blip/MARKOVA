import java.util.Properties

plugins {
    id("com.android.application")
}

// Clé de signature : android/keystore.properties + android/markova-release.jks (locaux, jamais commités).
// Son empreinte SHA-256 est déclarée dans public/.well-known/assetlinks.json du site :
// c'est ce qui permet d'ouvrir MARKOVA en plein écran, sans barre d'adresse.
val keystore = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// Adresse du site MARKOVA ouvert par l'application.
val siteHost = "markova-dtr1.vercel.app"
val siteUrl = "https://$siteHost/"

android {
    namespace = "com.markova.app"
    compileSdk = 37 // seule plateforme installée sur la machine (D:\droid\platforms)

    defaultConfig {
        applicationId = "com.markova.app"
        minSdk = 23
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        manifestPlaceholders["hostName"] = siteHost
        manifestPlaceholders["defaultUrl"] = siteUrl
        resValue("string", "app_name", "MARKOVA")
        resValue(
            "string",
            "asset_statements",
            """[{ "relation": ["delegate_permission/common.handle_all_urls"], "target": { "namespace": "web", "site": "https://$siteHost" } }]""",
        )
    }

    signingConfigs {
        create("release") {
            if (keystore.isNotEmpty()) {
                storeFile = rootProject.file(keystore.getProperty("storeFile").removePrefix("../"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        // Même clé en debug : l'empreinte reste celle déclarée sur le site.
        debug {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        resValues = true // app_name et asset_statements générés ci-dessus
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Bibliothèque Google des Trusted Web Activities (lanceur, délégation des notifications, écran de démarrage).
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.3")
}
