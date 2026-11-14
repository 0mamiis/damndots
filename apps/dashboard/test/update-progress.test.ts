import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Spinner, UpdateProgress} from '../components/update-progress';

test('the update indicator shows a spinner, the step text and a stage bar', () => {
  const html = renderToStaticMarkup(createElement(UpdateProgress, {label: 'Applying the update', pending: false, status: 'applying'}));
  assert.match(html, /animate-spin/);
  assert.match(html, /Applying the update/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="66"/);
  assert.match(html, /width:66%/);
});

test('a pending install shows progress before the job reports a stage', () => {
  const html = renderToStaticMarkup(createElement(UpdateProgress, {label: 'Starting the update…', pending: true}));
  assert.match(html, /aria-valuenow="8"/);
  assert.match(html, /role="status"/);
});

test('an unknown stage keeps a visible bar and the spinner', () => {
  const html = renderToStaticMarkup(createElement(UpdateProgress, {label: 'Working', pending: false, status: 'something-new'}));
  assert.match(html, /aria-valuenow="12"/);
  assert.match(renderToStaticMarkup(createElement(Spinner)), /animate-spin/);
});
