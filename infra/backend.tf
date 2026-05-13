# Bucket is supplied via `-backend-config=bucket=...` in bootstrap.sh.
# This file is mv'd to backend.tf.disabled during phase 1 so the state
# bucket itself can be created with local state, then restored for phase 2.
terraform {
  backend "gcs" {
    prefix = "aifredo/state"
  }
}
