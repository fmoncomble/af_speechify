document.addEventListener('DOMContentLoaded', function () {
  const extractButton = document.getElementById('extractButton');
  const urlDisplay = document.getElementById('urlDisplay');
  const statusDiv = document.getElementById('status');

  extractButton.addEventListener('click', async function () {
    try {
      const response = await new Promise((resolve, reject) => {
        browser.runtime.sendMessage({ action: 'getTabUrl' }, resolve);
      });

      const url = response.url;
      if (url) {
        urlDisplay.textContent = `URL: ${url}`;
        statusDiv.textContent = 'Extraction en cours...';

        const fetchedUrls = await performExtractAndSave(url);

        const downloadedFilesContainer = document.getElementById('downloadedFiles');
        downloadedFilesContainer.innerHTML = `Fichiers téléchargés:<br>${fetchedUrls.join('<br>')}`;

        statusDiv.textContent = 'Fini !';
      }
    } catch (error) {
      console.error('Error:', error);
      statusDiv.textContent = `Une erreur s'est produite`;
    }
  });
});

async function generateUniqueZipFileName(baseName, existingFileNames) {
  let fileName = baseName + '.zip';
  let index = 1;

  while (existingFileNames.has(fileName)) {
    fileName = `${baseName}_${index}.zip`;
    index++;
  }

  return fileName;
}

async function performExtractAndSave(url) {
  const parser = new DOMParser();
  const response = await fetch(url);
  const html = await response.text();

  const doc = parser.parseFromString(html, 'text/html');

  const speechesDiv = doc.querySelector('.speeches');
  if (!speechesDiv) {
    throw new Error('Speeches div non trouvée');
  }

  const paragraphs = speechesDiv.querySelectorAll('p');
  const urls = Array.from(paragraphs).map(p =>
    new URL(p.querySelector('a').getAttribute('href'), 'https://www.academie-francaise.fr/').href
  );

  const zip = new JSZip();

  const addedFileNames = new Set(); // To track added file names

  await Promise.all(urls.map(async url => {
    try {
      const contentResponse = await fetch(url);
      const content = await contentResponse.text();
      const contentDoc = parser.parseFromString(content, 'text/html');

      const bodyDiv = contentDoc.querySelector('.academie-columns.academie-columns-1');
      const authorElement = contentDoc.querySelector('.category.color');
      const dateElement = contentDoc.querySelector('[property="dc:date dc:created"]');

      if (!bodyDiv || !authorElement) {
        console.error('Erreur : éléments requis non trouvés');
        return;
      }

      const text = bodyDiv.textContent;
      const author = authorElement.querySelector('a').textContent;
      const date = dateElement ? dateElement.getAttribute('content') : 'Unknown Date';

      let baseFileName = `${author}.xml`;
      let index = 1;

      // Append a number to the file name to make it unique
      while (addedFileNames.has(baseFileName)) {
        baseFileName = `${author}_${index}.xml`;
        index++;
      }

      addedFileNames.add(baseFileName);

      const xmlContent = `
        <Text author="${author}" date="${date}">
          ${text}
        </Text>
      `;

      // Add the XML content to the zip archive
      zip.file(baseFileName, xmlContent);

    } catch (error) {
      console.error('Erreur en récupérant le contenu :', error);
    }
  }));

  const zipBlob = await zip.generateAsync({ type: 'blob' });

  // Generate a unique zip file name
  const zipBaseFileName = 'xml_archive';
  const zipFileName = await generateUniqueZipFileName(zipBaseFileName, addedFileNames);

  // Check if the generated zip file name already exists in the download folder
  const existingDownloads = await browser.downloads.search({ filename: zipFileName });
  if (existingDownloads.length > 0) {
    // Generate a unique name if the file already exists
    const uniqueZipFileName = await generateUniqueZipFileName(zipBaseFileName, addedFileNames);
    // Update the zip file name to the unique name
    zipFileName = uniqueZipFileName;
  }

  const downloadPromise = new Promise((resolve, reject) => {
    browser.downloads.download({
      url: URL.createObjectURL(zipBlob),
      filename: zipFileName,
      saveAs: false,
    }, downloadId => {
      if (downloadId) {
        resolve(zipFileName);
      } else {
        reject(new Error(`Echec au téléchargement de ${zipFileName}`));
      }
    });
  });

  await downloadPromise;

  return Array.from(addedFileNames);
}