const cloudinary = require('cloudinary').v2; // v1.x também exporta .v2
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Cria um multer configurado para fazer upload direto no Cloudinary
function criarUpload({ folder, allowedFormats, resourceType = 'auto' }) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: `gm-mobile/${folder}`,
      allowed_formats: allowedFormats,
      resource_type: resourceType,
    },
  });
  return multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
}

// Deleta um arquivo pelo public_id ou URL
async function deletarArquivo(urlOrPublicId) {
  if (!urlOrPublicId) return;
  try {
    // Se for URL do Cloudinary, extrai o public_id
    if (urlOrPublicId.includes('cloudinary.com')) {
      const parts = urlOrPublicId.split('/');
      const uploadIdx = parts.indexOf('upload');
      if (uploadIdx !== -1) {
        // Remove versão (v12345) se presente
        const fromUpload = parts.slice(uploadIdx + 1);
        if (/^v\d+$/.test(fromUpload[0])) fromUpload.shift();
        const publicIdWithExt = fromUpload.join('/');
        const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
        await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      }
    }
  } catch (e) {
    console.error('Erro ao deletar arquivo Cloudinary:', e.message);
  }
}

module.exports = { cloudinary, criarUpload, deletarArquivo };
