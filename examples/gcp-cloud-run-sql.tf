# Cloud Run in front of Cloud SQL.
#
# Import this with the Import button to see it as a graph.

provider "google" {
  project = "my-project-id"
  region  = "us-central1"
}

# --- APIs -------------------------------------------------------------------

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "sqladmin" {
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

# --- Database ---------------------------------------------------------------

resource "google_sql_database_instance" "app" {
  name                = "app-db"
  database_version    = "POSTGRES_15"
  region              = "us-central1"
  deletion_protection = false

  settings {
    tier = "db-f1-micro"
  }
}

resource "google_sql_database" "app" {
  name     = "app"
  instance = google_sql_database_instance.app.name
}

resource "google_sql_user" "app" {
  name     = "app"
  password = "change-me"
  instance = google_sql_database_instance.app.name
}

# --- Identity ---------------------------------------------------------------

resource "google_service_account" "api" {
  account_id   = "api-runner"
  display_name = "Cloud Run API service account"
}

resource "google_project_iam_member" "api_sql_client" {
  project = "my-project-id"
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:api-runner@my-project-id.iam.gserviceaccount.com"
}

# --- Service ----------------------------------------------------------------

resource "google_cloud_run_v2_service" "api" {
  name                = "api"
  location            = "us-central1"
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.api.email

    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      env {
        name  = "DB_NAME"
        value = "app"
      }

      env {
        name  = "DB_USER"
        value = "app"
      }
    }

    volumes {
      name = "cloudsql"

      cloud_sql_instance {
        instances = [google_sql_database_instance.app.connection_name]
      }
    }
  }
}
