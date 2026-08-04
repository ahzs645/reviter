#!/usr/bin/env node

// Edge-level first-person comparison for two locked-camera screenshots.
// The recovered frame is shown in grey; reference edges with no nearby
// recovered edge are painted red. This avoids calling a material-colour change
// a geometry difference while still exposing missing tread noses and frames.

import sharp from "sharp";

const [recoveredPath, referencePath, outputPath, xText, yText, widthText, heightText] =
  process.argv.slice(2);

if (!heightText) {
  console.error(
    "usage: first-person-image-diff.mjs recovered.jpg reference.jpg out.png x y width height",
  );
  process.exit(2);
}

const cropX = Number.parseInt(xText, 10);
const cropY = Number.parseInt(yText, 10);
const cropWidth = Number.parseInt(widthText, 10);
const cropHeight = Number.parseInt(heightText, 10);
if ([cropX, cropY, cropWidth, cropHeight].some((value) => !Number.isInteger(value))) {
  throw new Error("Crop values must be integers");
}

async function loadRaster(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: data };
}

function luminance(raster) {
  const output = new Uint8Array(raster.width * raster.height);
  for (let index = 0; index < output.length; index += 1) {
    const offset = index * 4;
    output[index] = Math.floor(
      (raster.pixels[offset] * 54 +
        raster.pixels[offset + 1] * 183 +
        raster.pixels[offset + 2] * 19) /
        256,
    );
  }
  return output;
}

function edgeStrength(values, width, height) {
  const output = new Uint8Array(values.length);
  if (width <= 2 || height <= 2) return output;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const horizontal = Math.abs(values[index + 1] - values[index - 1]);
      const vertical = Math.abs(values[index + width] - values[index - width]);
      output[index] = Math.max(horizontal, vertical);
    }
  }
  return output;
}

const recovered = await loadRaster(recoveredPath);
const reference = await loadRaster(referencePath);
if (recovered.width !== reference.width || recovered.height !== reference.height) {
  throw new Error("Screenshots must have identical dimensions");
}

const recoveredLuminance = luminance(recovered);
const referenceLuminance = luminance(reference);
const recoveredEdges = edgeStrength(recoveredLuminance, recovered.width, recovered.height);
const referenceEdges = edgeStrength(referenceLuminance, reference.width, reference.height);
const output = Buffer.alloc(recovered.pixels.length);
for (let index = 0; index < recoveredLuminance.length; index += 1) {
  const value = Math.max(28, Math.min(226, Math.floor(recoveredLuminance[index] * 3 / 4 + 40)));
  const offset = index * 4;
  output[offset] = value;
  output[offset + 1] = value;
  output[offset + 2] = value;
  output[offset + 3] = 255;
}

const minX = Math.max(2, cropX);
const maxX = Math.min(recovered.width - 3, cropX + cropWidth - 1);
const minY = Math.max(2, cropY);
const maxY = Math.min(recovered.height - 3, cropY + cropHeight - 1);
let referenceEdgePixels = 0;
let missingReferenceEdgePixels = 0;
const missing = new Uint8Array(recovered.width * recovered.height);

if (minX <= maxX && minY <= maxY) {
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = y * recovered.width + x;
      const referenceStrength = referenceEdges[index];
      if (referenceStrength < 18) continue;
      referenceEdgePixels += 1;
      let nearbyRecoveredStrength = 0;
      for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
        for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
          nearbyRecoveredStrength = Math.max(
            nearbyRecoveredStrength,
            recoveredEdges[(y + offsetY) * recovered.width + x + offsetX],
          );
        }
      }
      // Compare edge presence, not contrast. The reference uses a dark canvas
      // while recovered Shaded mode uses a pale canvas, so scaling this gate by
      // the GLB edge strength painted every shared silhouette red even when the
      // geometry was coincident. A small absolute gate plus a three-pixel
      // antialiasing allowance keeps material and background changes grey.
      if (nearbyRecoveredStrength < 12) {
        missing[index] = 1;
        missingReferenceEdgePixels += 1;
      }
    }
  }
}

for (let y = minY; y <= maxY; y += 1) {
  for (let x = minX; x <= maxX; x += 1) {
    if (!missing[y * recovered.width + x]) continue;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const offset = ((y + offsetY) * recovered.width + x + offsetX) * 4;
        output[offset] = 218;
        output[offset + 1] = 38;
        output[offset + 2] = 46;
        output[offset + 3] = 255;
      }
    }
  }
}

await sharp(output, {
  raw: { width: recovered.width, height: recovered.height, channels: 4 },
}).png().toFile(outputPath);

const missingShare = referenceEdgePixels === 0
  ? 0
  : missingReferenceEdgePixels / referenceEdgePixels;
console.log(JSON.stringify({ referenceEdgePixels, missingReferenceEdgePixels, missingShare }));
