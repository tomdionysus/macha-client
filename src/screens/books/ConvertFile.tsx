import { useEffect, useRef, useState } from 'react';
import {
  awaitConversion,
  CONVERSION_FORMATS,
  CONVERSION_UNAVAILABLE_CODE,
  isConvertibleContentType,
  playbackFailureCode,
  type CatalogueApi,
  type CatalogueConversion,
  type ConversionFailureCode,
  type ConversionFormat,
} from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';
import { formatBytes } from '../ingest/format';
import { readableHere, saveBlob } from './bookFiles';

const FAILED_TEXT = 'The conversion did not work for this file.';

/** Why a conversion failed, in the viewer's words; a code not named here reads as a plain failure. */
export const CONVERSION_FAILURE_TEXT: Record<ConversionFailureCode, string> = {
  conversion_failed: FAILED_TEXT,
  conversion_timed_out: 'The conversion took too long and was stopped.',
  source_unreadable: 'The server could not read this file to convert it.',
  source_too_large: 'This file is too large to convert.',
  encrypted: 'This file is locked by its seller (DRM), so it cannot be converted.',
  unsupported_source: 'The server cannot convert files of this format.',
};

/** The viewer's sentence for a failed conversion's code. */
export function conversionFailureText(code: string | null | undefined): string {
  return (code && (CONVERSION_FAILURE_TEXT as Record<string, string>)[code]) || FAILED_TEXT;
}

/** A refused conversion: no node with conversion switched on gets this client's sentence, anything else the usual one. */
export function conversionRefusalText(cause: unknown): string {
  if (playbackFailureCode(cause) === CONVERSION_UNAVAILABLE_CODE) return 'No server here can convert books: conversion is switched on per server.';
  return viewerErrorText(cause);
}

/** The formats a file served as this type can become on the server: none unless core says the type converts. */
export function conversionTargets(contentType: string): ConversionFormat[] {
  return isConvertibleContentType(contentType) ? [...CONVERSION_FORMATS] : [];
}

type State =
  | { phase: 'idle' }
  | { phase: 'converting'; format: ConversionFormat }
  | { phase: 'ready'; conversion: CatalogueConversion }
  | { phase: 'failed'; text: string };

/**
 * Converts one of a book's files to another format on the server, then reads or downloads the
 * result. The server converts in its own time, so this waits on it, on the node that took the job.
 */
export function ConvertFile({ catalogue, mediaId, contentType, title, onRead }: {
  catalogue: CatalogueApi;
  mediaId: string;
  /** The type the server serves the file as, which says whether it converts. */
  contentType: string;
  title: string;
  onRead: (mediaId: string, format: ConversionFormat) => void;
}) {
  const targets = conversionTargets(contentType);
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [saving, setSaving] = useState(false);
  const running = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => running.current?.abort(), []);

  const convert = async (target: ConversionFormat) => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setState({ phase: 'converting', format: target });
    try {
      const started = await catalogue.convert(mediaId, target, controller.signal);
      const done = started.status === 'converting' ? await awaitConversion(catalogue, started, { signal: controller.signal }) : started;
      if (controller.signal.aborted) return;
      setState(done.status === 'ready'
        ? { phase: 'ready', conversion: done }
        : { phase: 'failed', text: conversionFailureText(done.errorCode) });
    } catch (cause) {
      if (!controller.signal.aborted) setState({ phase: 'failed', text: conversionRefusalText(cause) });
    }
  };

  const download = async (conversion: CatalogueConversion) => {
    setSaving(true);
    try {
      const read = await catalogue.conversionContent(conversion);
      saveBlob(read.body, title, conversion.format.toUpperCase());
    } catch (cause) {
      setState({ phase: 'failed', text: conversionRefusalText(cause) });
    } finally {
      setSaving(false);
    }
  };

  if (targets.length === 0) return null;
  const busy = state.phase === 'converting';
  return (
    <div className="book-convert">
      {targets.map((target) => (
        <button key={target} className="secondary-button" type="button" disabled={busy} onClick={() => void convert(target)} data-tv-focusable="true">
          {busy && state.format === target ? `Converting to ${target.toUpperCase()}…` : `Convert to ${target.toUpperCase()}`}
        </button>
      ))}
      {state.phase === 'ready' && (
        <>
          <span className="book-file-size">{state.conversion.format.toUpperCase()}{state.conversion.size !== null ? `, ${formatBytes(state.conversion.size)}` : ''}</span>
          {readableHere({ format: state.conversion.format.toUpperCase() }) && (
            <button className="primary-button" type="button" onClick={() => onRead(mediaId, state.conversion.format)} data-tv-focusable="true">Read</button>
          )}
          <button className="secondary-button" type="button" disabled={saving} onClick={() => void download(state.conversion)} data-tv-focusable="true">
            {saving ? 'Downloading…' : 'Download'}
          </button>
        </>
      )}
      {state.phase === 'failed' && <span className="book-file-error" role="alert">{state.text}</span>}
    </div>
  );
}
