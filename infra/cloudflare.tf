resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "brain" {
  account_id    = var.cloudflare_account_id
  name          = "aifredo-brain"
  tunnel_secret = random_id.tunnel_secret.b64_std
  config_src    = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "brain" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.brain.id

  config {
    ingress_rule {
      hostname = "brain.${var.domain}"
      service  = "http://localhost:8080"
    }
    # Catch-all required by Cloudflare Tunnel
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "cloudflare_record" "brain" {
  zone_id = var.cloudflare_zone_id
  name    = "brain"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.brain.id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
  comment = "AIfredo brain tunnel"
}
