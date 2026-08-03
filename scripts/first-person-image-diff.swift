#!/usr/bin/env swift

// Edge-level first-person comparison for two locked-camera screenshots.
// The recovered frame is shown in grey; reference edges with no nearby
// recovered edge are painted red. This avoids calling a material-colour change
// a geometry difference while still exposing missing tread noses and frames.

import CoreGraphics
import Foundation
import ImageIO

struct Raster {
  let width: Int
  let height: Int
  var pixels: [UInt8]
}

func loadRaster(_ path: String) throws -> Raster {
  let url = URL(fileURLWithPath: path) as CFURL
  guard
    let source = CGImageSourceCreateWithURL(url, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw NSError(domain: "first-person-image-diff", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "Could not decode \(path)",
    ])
  }
  let width = image.width
  let height = image.height
  var pixels = [UInt8](repeating: 0, count: width * height * 4)
  guard let context = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    throw NSError(domain: "first-person-image-diff", code: 2, userInfo: [
      NSLocalizedDescriptionKey: "Could not create image context",
    ])
  }
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  return Raster(width: width, height: height, pixels: pixels)
}

func luminance(_ raster: Raster) -> [Int] {
  var output = [Int](repeating: 0, count: raster.width * raster.height)
  for index in output.indices {
    let offset = index * 4
    output[index] = (
      Int(raster.pixels[offset]) * 54 +
      Int(raster.pixels[offset + 1]) * 183 +
      Int(raster.pixels[offset + 2]) * 19
    ) / 256
  }
  return output
}

func edgeStrength(_ luminance: [Int], width: Int, height: Int) -> [Int] {
  var output = [Int](repeating: 0, count: luminance.count)
  guard width > 2 && height > 2 else { return output }
  for y in 1..<(height - 1) {
    for x in 1..<(width - 1) {
      let index = y * width + x
      let horizontal = abs(luminance[index + 1] - luminance[index - 1])
      let vertical = abs(luminance[index + width] - luminance[index - width])
      output[index] = max(horizontal, vertical)
    }
  }
  return output
}

func writePng(_ raster: Raster, to path: String) throws {
  guard
    let provider = CGDataProvider(data: Data(raster.pixels) as CFData),
    let image = CGImage(
      width: raster.width,
      height: raster.height,
      bitsPerComponent: 8,
      bitsPerPixel: 32,
      bytesPerRow: raster.width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
      provider: provider,
      decode: nil,
      shouldInterpolate: false,
      intent: .defaultIntent
    ),
    let destination = CGImageDestinationCreateWithURL(
      URL(fileURLWithPath: path) as CFURL,
      "public.png" as CFString,
      1,
      nil
    )
  else {
    throw NSError(domain: "first-person-image-diff", code: 3, userInfo: [
      NSLocalizedDescriptionKey: "Could not create \(path)",
    ])
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw NSError(domain: "first-person-image-diff", code: 4, userInfo: [
      NSLocalizedDescriptionKey: "Could not write \(path)",
    ])
  }
}

let arguments = CommandLine.arguments
guard arguments.count == 8 else {
  FileHandle.standardError.write(Data(
    "usage: first-person-image-diff.swift recovered.jpg reference.jpg out.png x y width height\n".utf8
  ))
  exit(2)
}

do {
  let recovered = try loadRaster(arguments[1])
  let reference = try loadRaster(arguments[2])
  guard recovered.width == reference.width && recovered.height == reference.height else {
    throw NSError(domain: "first-person-image-diff", code: 5, userInfo: [
      NSLocalizedDescriptionKey: "Screenshots must have identical dimensions",
    ])
  }
  guard
    let cropX = Int(arguments[4]),
    let cropY = Int(arguments[5]),
    let cropWidth = Int(arguments[6]),
    let cropHeight = Int(arguments[7])
  else {
    throw NSError(domain: "first-person-image-diff", code: 6, userInfo: [
      NSLocalizedDescriptionKey: "Crop values must be integers",
    ])
  }

  let recoveredLuminance = luminance(recovered)
  let referenceLuminance = luminance(reference)
  let recoveredEdges = edgeStrength(
    recoveredLuminance,
    width: recovered.width,
    height: recovered.height
  )
  let referenceEdges = edgeStrength(
    referenceLuminance,
    width: reference.width,
    height: reference.height
  )
  var output = recovered
  for index in recoveredLuminance.indices {
    let value = UInt8(max(28, min(226, recoveredLuminance[index] * 3 / 4 + 40)))
    let offset = index * 4
    output.pixels[offset] = value
    output.pixels[offset + 1] = value
    output.pixels[offset + 2] = value
    output.pixels[offset + 3] = 255
  }

  let minX = max(2, cropX)
  let maxX = min(recovered.width - 3, cropX + cropWidth - 1)
  let minY = max(2, cropY)
  let maxY = min(recovered.height - 3, cropY + cropHeight - 1)
  var referenceEdgePixels = 0
  var missingReferenceEdgePixels = 0
  var missing = [Bool](repeating: false, count: recovered.width * recovered.height)
  if minX <= maxX && minY <= maxY {
    for y in minY...maxY {
      for x in minX...maxX {
        let index = y * recovered.width + x
        let referenceStrength = referenceEdges[index]
        if referenceStrength < 18 { continue }
        referenceEdgePixels += 1
        var nearbyRecoveredStrength = 0
        for offsetY in -2...2 {
          for offsetX in -2...2 {
            nearbyRecoveredStrength = max(
              nearbyRecoveredStrength,
              recoveredEdges[(y + offsetY) * recovered.width + x + offsetX]
            )
          }
        }
        if nearbyRecoveredStrength < max(12, referenceStrength * 3 / 5) {
          missing[index] = true
          missingReferenceEdgePixels += 1
        }
      }
    }
  }

  // A two-pixel red mark remains legible after the app scales the screenshot.
  for y in minY...maxY {
    for x in minX...maxX where missing[y * recovered.width + x] {
      for offsetY in -1...1 {
        for offsetX in -1...1 {
          let index = (y + offsetY) * recovered.width + x + offsetX
          let offset = index * 4
          output.pixels[offset] = 218
          output.pixels[offset + 1] = 38
          output.pixels[offset + 2] = 46
          output.pixels[offset + 3] = 255
        }
      }
    }
  }

  try writePng(output, to: arguments[3])
  let missingShare = referenceEdgePixels == 0
    ? 0
    : Double(missingReferenceEdgePixels) / Double(referenceEdgePixels)
  let formattedMissingShare = String(format: "%.6f", missingShare)
  print("{\"referenceEdgePixels\":\(referenceEdgePixels),\"missingReferenceEdgePixels\":\(missingReferenceEdgePixels),\"missingShare\":\(formattedMissingShare)}")
} catch {
  FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
  exit(1)
}
