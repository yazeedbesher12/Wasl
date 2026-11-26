# API resource limits

## Authentication

Valid request bodies reach the limiter before credential lookup, password verification, token rotation, or family revocation. School switching also requires an authenticated identity. Wasl has no password reset or change endpoint. Each operation has its own 60-second fixed window per API process.

| Operation | Per source | Additional limit |
| --- | ---: | --- |
| Login | 30 | 8 per source and normalized email, 8 concurrent login operations per process |
| Refresh | 120 | |
| Logout | 120 | |
| Switch school | 120 | 24 per authenticated user |

The limiter counts successful as well as unsuccessful requests. Its window stores at most 4,096 keys per operation. At capacity, new keys wait for the next window. Windows expire without an account lock, and a process restart clears counters. Login identifiers are keyed digests in memory. A throttled request receives a generic `429` with `Retry-After` and `Cache-Control: no-store`. Failed login responses remain generic for unknown accounts and incorrect passwords.

Express uses the socket peer by default. For a dedicated reverse proxy, set `WASL_TRUSTED_PROXY_IPS` to the comma-separated literal addresses of trusted forwarding hops. Network policy must restrict proxy peers and the public edge must overwrite incoming `X-Forwarded-For` with the actual client address before internal trusted hops append their peer. Express stops at the first untrusted address. IPv6 clients share a quota within their /64. The Next.js proxy forwards neither incoming client-IP headers nor caller-supplied forwarding claims, so its browser clients share the API source allowance. Apply client limits at the public web edge. With the current topology, a busy shared source can cause legitimate throttling.

Limits are process-local. For load-balanced APIs, clustered workers, or multiple web instances, enforce shared rate limiting at the ingress or use a verified shared limiter before rollout. Keep edge limits on connections and request bodies to cover malformed requests and work before the route-level checks.

## Private uploads

Nest admits up to four concurrent uploads per API process and two per authenticated school. A slot covers multipart parsing, validation, object storage, and the metadata transaction. The Next.js proxy admits four uploads per proxy instance before reading request bodies. Excess requests return `503` with `Retry-After: 1`. Both layers give the client up to 60 seconds to deliver the upload. The API closes an incomplete request at that deadline. An upload whose body has arrived may finish if the client disconnects during persistence.

Multer buffers one file of at most 10 MiB and accepts only bounded multipart fields. The web proxy caps total upload body bytes at 10 MiB plus 64 KiB. The API applies the same cap to declared body length and applies Multer's file and field limits to streamed requests. Set a total body limit and receive deadline on the public edge for direct clients using chunked uploads. Size, extension, MIME, and content validation run before putting bytes in private storage. Multipart parsing uses memory buffering and creates no temporary upload files. Authorization, school-scoped file paths, and authenticated downloads use the existing rules.

When object creation fails or metadata fails before it can commit, the API attempts to remove the generated object. S3 write and cleanup requests each have a 30-second client deadline. Failed cleanup logs the generated file ID. An uncertain S3 write also logs the ID after successful cleanup because the provider might finish the write after the removal. A conditional-write conflict or uncertain metadata commit retains the object and logs the file ID for reconciliation. Check the authoritative database and object inventory before removing a candidate. A process failure between object creation and metadata commit can also require reconciliation. No automatic age-based deletion runs against uploaded objects.

Concurrency controls bound in-flight uploads. A persistent per-school byte quota and retention policy require product decisions and durable accounting that includes orphaned objects. Configure bucket or volume capacity alerts and establish an operator review procedure before enabling unmonitored uploads. Verify private bucket access, deadlines, conditional-write semantics, and cleanup behavior against the deployed S3-compatible provider.
