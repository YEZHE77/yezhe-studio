// macOS Vision OCR：node 侧调用 xcrun swift ocr-image.swift <image路径>
// 输出按从上到下、从左到右排序的识别文本（含归一化坐标）
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count >= 2 else {
    print("usage: ocr-image.swift <image>")
    exit(1)
}
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERR: cannot load image")
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([request])

struct Item {
    let text: String
    let x: Double
    let y: Double
}
var items: [Item] = []
for obs in request.results ?? [] {
    guard let cand = obs.topCandidates(1).first else { continue }
    let b = obs.boundingBox
    items.append(Item(text: cand.string, x: Double(b.minX), y: Double(b.minY)))
}
// y 越大越靠上（Vision 坐标原点在左下）
items.sort { (a, b) -> Bool in
    if abs(a.y - b.y) > 0.02 { return a.y > b.y }
    return a.x < b.x
}
for it in items {
    print(String(format: "[%.3f,%.3f] %@", it.x, it.y, it.text))
}
