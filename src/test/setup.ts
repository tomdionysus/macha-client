import { configureClientDiagnostics } from '../diagnostics/ClientLog';

// Expected playback failure/recovery tests exercise verbose diagnostics. Keep
// collecting those entries while reserving test stdout/stderr for assertions
// and unexpected failures.
configureClientDiagnostics({ console: false });
