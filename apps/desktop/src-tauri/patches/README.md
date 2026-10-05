# Patches

## `russh`

Pinned copy of `russh` 0.48.2 with a fix for RSA public-key authentication.

Upstream probes RSA keys as `ssh-rsa` while `sign_workaround` produces
`rsa-sha2-512` signatures. Modern OpenSSH rejects that mismatch (RFC 8332),
so imported or generated RSA keys fail auth even though they import cleanly.

This fork advertises `rsa-sha2-512` for RSA keys in the USERAUTH probe and
signed request, matching the signature algorithm.
