import { describe, expect, test } from 'bun:test';
import { ApiError } from '../api.ts';
import { uploadErrorMessage } from './upload-error.ts';

describe('uploadErrorMessage', () => {
  test("uses the server's JSON error text for an unsupported type", () => {
    const err = new ApiError(
      400,
      JSON.stringify({ error: 'Unsupported file type: .svg' }),
    );
    expect(uploadErrorMessage(err, 'logo.svg')).toBe(
      'Couldn\'t upload "logo.svg": Unsupported file type: .svg',
    );
  });

  test("uses the server's JSON error text for a too-large file", () => {
    const err = new ApiError(
      413,
      JSON.stringify({ error: 'Upload too large (max 10 MiB)' }),
    );
    expect(uploadErrorMessage(err, 'big.png')).toBe(
      'Couldn\'t upload "big.png": Upload too large (max 10 MiB)',
    );
  });

  test('accepts a structured {error: {message}} body', () => {
    const err = new ApiError(
      503,
      JSON.stringify({ error: { code: 'busy', message: 'Repository busy' } }),
    );
    expect(uploadErrorMessage(err)).toBe(
      "Couldn't upload image: Repository busy",
    );
  });

  test('a 413 without a usable body still says it is too large', () => {
    const err = new ApiError(413, '<html><body>Too big</body></html>');
    expect(uploadErrorMessage(err, 'a.png')).toBe(
      'Couldn\'t upload "a.png": File is too large',
    );
  });

  test('shows a short plain-text body verbatim', () => {
    expect(uploadErrorMessage(new ApiError(500, 'disk full\n'))).toBe(
      "Couldn't upload image: disk full",
    );
  });

  test('falls back to the status for an HTML, empty or huge body', () => {
    for (const body of ['<!doctype html><p>oops</p>', '', 'x'.repeat(500)]) {
      expect(uploadErrorMessage(new ApiError(502, body))).toBe(
        "Couldn't upload image: Server error (HTTP 502)",
      );
    }
  });

  test('JSON without an error field falls back to the status', () => {
    expect(uploadErrorMessage(new ApiError(500, '{"ok":false}'))).toBe(
      "Couldn't upload image: Server error (HTTP 500)",
    );
  });

  test('a fetch TypeError is a network error', () => {
    expect(
      uploadErrorMessage(new TypeError('Failed to fetch'), 'shot.png'),
    ).toBe(
      'Couldn\'t upload "shot.png": Network error: could not reach the server',
    );
  });

  test('other errors use their message', () => {
    expect(uploadErrorMessage(new Error('boom'))).toBe(
      "Couldn't upload image: boom",
    );
    expect(uploadErrorMessage('weird')).toBe(
      "Couldn't upload image: Unknown error",
    );
  });
});
