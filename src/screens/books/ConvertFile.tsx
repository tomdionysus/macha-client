import { useEffect, useRef, useState } from 'react';
import {
  awaitConversion,
  CONVERSION_FORMATS,
  CONVERSION_UNAVAILABLE_CODE,
  playbackFailureCode,
  type CatalogueApi,
  type CatalogueConversion,
  type ConversionFailureCode,
  type ConversionFormat,
} from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';
import { formatBytes } from '../ingest/format';
import { readableHere, saveBlob } from './bookFiles';

/** Why a conversion failed, in the viewer's words. */
export const CONVERSION_FAILURE_TEXT: Record<ConversionFailureCode, string> = {
  conversion_failed: 'The conversion did not work for this file.',
  conversion_timed_out: 'The conversion took too long and was stopped.',
  source_unreadable: 'The server could not read this file to convert it.',
  source_too_large: 'This file is too large to convert.',
};

/** A refused conversion: no node with conversion switched on gets this client's sentence, anything else the usual one. */
export function conversionRefusalText(cause: unknown): string {
  if (playbackFailureCode(cause) === CONVERSION_UNAVAILABLE_CODE) return 'No server here can convert books: conversion is switched on per server.';
  return viewerErrorText(cause);
}

/** The formats a file of this one can become: every conversion format but its own. */
export function conversionTargets(format: string | undefined): ConversionFormat[] {
  return CONVERSION_FORMATS.filter((target) => target !== format?.toLowerCase());
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
export function ConvertFile({ catalogue, mediaId, format, title, onRead }: {
  catalogue: CatalogueApi;
  mediaId: string;
  /** The file's own format, as named here ("EPUB"); undefined when unnamed. */
  format: string | undefined;
  title: string;
  onRead: (mediaId: string, format: ConversionFormat) => void;
}) {
  const targets = conversionTargets(format);
  const [target, setTarget] = useState<ConversionFormat>(targets[0] ?? 'epub');
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [saving, setSaving] = useState(false);
  const running = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => running.current?.abort(), []);

  const convert = async () => {
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
        : { phase: 'failed', text: done.errorCode ? CONVERSION_FAILURE_TEXT[done.errorCode] : 'The conversion did not work for this file.' });
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
      <label>
        <span>Convert to</span>
        <select value={target} disabled={busy} onChange={(event) => { setTarget(event.target.value as ConversionFormat); setState({ phase: 'idle' }); }} data-tv-focusable="true">
          {targets.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
        </select>
      </label>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void convert()} data-tv-focusable="true">
        {busy ? `Converting to ${state.format.toUpperCase()}…` : 'Convert'}
      </button>
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
