# MedDecode

Intelligence Behind Every Prescription. MedDecode is being developed to process prescription documents and organize extracted medicine information.

## Repository layout

- `backend/`: Node.js/Express application-service scaffold. See [backend execution notes](backend/README.md).
- `intelligence/`: Python document processing, OCR, information extraction, medicine understanding, and tests. See [intelligence execution notes](intelligence/README.md).

## Development status

This is a local structural integration of the backend and intelligence branch histories. It does not establish a complete application or verified end-to-end integration. No frontend has been added.

The backend currently exposes a health endpoint and includes configuration and a Supabase client. Intelligence layers 1-3 have source and tests; `app/main.py` and the layer 4/5 initialization files are empty. A running intelligence HTTP service is not established by this snapshot.

Use each service directory as its working directory. Dependency installation, runtime tests, OCR execution, and cloud connectivity have not been verified in this integration phase. Service owners must confirm dependencies and API contracts before application integration.
