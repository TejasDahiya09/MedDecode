# Prescription processing formats

The authenticated prescription upload API accepts `application/pdf`,
`image/jpeg` (`.jpg` or `.jpeg`), and `image/png`. The processing worker accepts
the same MIME types; submission and result HTTP response shapes do not change.
Upload does not automatically request processing. Clients should submit the
returned prescription ID through the existing processing endpoint.

The worker validates the original document format and limits image dimensions
to 10,000 pixels per side and 25 million pixels total. Its Python boundary
currently limits document bytes to 10 MiB even if the upload limit is raised.
Images are corrected using EXIF orientation; transparent pixels are composited
on white. Invalid, mislabeled, multi-frame, oversized, or undecodable images
fail processing. The original object and stored MIME type are preserved.

Enabling the hosted worker remains a separate operational decision; upload
availability does not imply that a worker is running.
