import { element } from './dom';

export interface DropZoneOptions {
  onFile(file: File): void;
}

export function createDropZone({ onFile }: DropZoneOptions): HTMLElement {
  const input = element('input', {
    attrs: {
      id: 'pdf-input',
      type: 'file',
      accept: 'application/pdf,.pdf',
      'data-testid': 'pdf-input',
    },
  });
  input.className = 'visually-hidden';

  const browseButton = element('span', { className: 'button button-primary', text: 'Choose PDF' });
  const dropZone = element(
    'label',
    {
      className: 'drop-zone-card',
      attrs: {
        for: 'pdf-input',
        'data-testid': 'dropzone',
      },
    },
    [
      element('span', { className: 'drop-icon', text: '⇩' }),
      element('span', { className: 'eyebrow', text: 'PDF Slide Splitter' }),
      element('h1', { text: 'Drop a lecture PDF and split it into one slide per page.' }),
      element('p', {
        text: 'Processed locally in your browser. Review the suggested grid before downloading a split PDF for GoodNotes or your PDF reader.',
      }),
      browseButton,
      element('span', { className: 'privacy-note', text: 'No cloud upload · source file unchanged' }),
      input,
    ],
  );

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  });

  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-drag-over');
    });
  }

  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('is-drag-over');
    });
  }

  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });

  return dropZone;
}
