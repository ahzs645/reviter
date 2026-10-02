using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using Microsoft.Win32;
using System.Security.Cryptography;
using System.Text.Json;

namespace Reviter.SemanticExport;

// Inventory only: never creates partitions, changes phases or guesses map keys.
[Transaction(TransactionMode.ReadOnly)]
public sealed class ExportFinishInventory : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        try
        {
            var doc = commandData.Application.ActiveUIDocument?.Document;
            if (doc is null) throw new InvalidOperationException("Open the exact source RVT first.");
            if (doc.IsModified || !File.Exists(doc.PathName) ||
                !string.Equals(Path.GetExtension(doc.PathName), ".rvt", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Use a saved local RVT with no unsaved changes. Export must match its exact disk bytes.");
            var dialog = new SaveFileDialog { Filter = "JSON inventory|*.json", FileName = "reviter-finish-inventory.json", OverwritePrompt = true };
            if (dialog.ShowDialog() != true) return Result.Cancelled;
            var digest = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(doc.PathName))).ToLowerInvariant();
            var diagnostics = new List<object>();
            var rooms = new List<object>();
            var boundarySupport = new Dictionary<long, object>();
            using var options = new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish };
            foreach (var room in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().OfType<Room>())
            {
                try
                {
                    var phaseId = room.get_Parameter(BuiltInParameter.ROOM_PHASE)?.AsElementId();
                    var phase = phaseId is null ? null : doc.GetElement(phaseId) as Phase;
                    var level = doc.GetElement(room.LevelId) as Level;
                    var circuits = room.GetBoundarySegments(options);
                    var rings = new List<double[][]>();
                    var boundaryIds = new HashSet<long>();
                    double? boundaryZ = null;
                    if (circuits is not null)
                    {
                        foreach (var circuit in circuits)
                        {
                            var points = new List<XYZ>();
                            foreach (var segment in circuit)
                            {
                                var vertices = segment.GetCurve().Tessellate().ToList();
                                if (vertices.Count < 2) throw new InvalidOperationException("Degenerate boundary segment.");
                                if (points.Count > 0 && points[^1].DistanceTo(vertices[0]) > 1e-6)
                                {
                                    if (points[^1].DistanceTo(vertices[^1]) <= 1e-6) vertices.Reverse();
                                    else throw new InvalidOperationException("Boundary circuit has a discontinuity; do not bridge it.");
                                }
                                foreach (var p in vertices)
                                {
                                    boundaryZ ??= p.Z;
                                    if (Math.Abs(p.Z - boundaryZ.Value) > 0.01) throw new InvalidOperationException("Boundary circuits are not coplanar.");
                                    if (points.Count == 0 || points[^1].DistanceTo(p) > 1e-8) points.Add(p);
                                }
                                if (segment.ElementId.Value > 0)
                                {
                                    boundaryIds.Add(segment.ElementId.Value);
                                    var support = doc.GetElement(segment.ElementId);
                                    if (support is not null) boundarySupport[support.Id.Value] = new {
                                        elementId = support.Id.Value, nativeUniqueId = support.UniqueId,
                                        name = support.Name, category = support.Category?.Name,
                                        roomBounding = support.get_Parameter(BuiltInParameter.WALL_ATTR_ROOM_BOUNDING)?.AsInteger(),
                                        createdPhaseId = support.CreatedPhaseId.Value,
                                        demolishedPhaseId = support.DemolishedPhaseId.Value
                                    };
                                }
                            }
                            if (points.Count < 4 || points[0].DistanceTo(points[^1]) > 1e-6)
                                throw new InvalidOperationException("Unclosed boundary circuit; no artificial closing edge exported.");
                            points.RemoveAt(points.Count - 1);
                            rings.Add(points.Select(p => new[] { p.X, p.Y }).ToArray());
                        }
                    }
                    if (rings.Count == 0) diagnostics.Add(new { nativeRoomUniqueId = room.UniqueId, code = "unenclosed-or-unplaced-room" });
                    rooms.Add(new {
                        nativeRoomUniqueId = room.UniqueId, nativeRoomId = room.Id.Value,
                        phaseUniqueId = phase?.UniqueId, nativeLevelId = room.LevelId.Value,
                        levelName = level?.Name, levelElevationFeet = level?.ProjectElevation,
                        elevationFeet = boundaryZ, number = room.Number, name = room.Name,
                        areaSquareFeet = room.Area,
                        labelPointFeet = room.Location is LocationPoint lp ? new[] { lp.Point.X, lp.Point.Y } : null,
                        ringsFeet = rings, boundaryElementIds = boundaryIds.Order().ToArray()
                    });
                }
                catch (Exception ex) { diagnostics.Add(new { nativeRoomUniqueId = room.UniqueId, code = "boundary-export-failed", detail = ex.Message }); }
            }
            var doors = new List<object>();
            var phases = doc.Phases.Cast<Phase>().ToArray();
            foreach (var door in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Doors).WhereElementIsNotElementType().OfType<FamilyInstance>())
                foreach (var phase in phases)
                {
                    try
                    {
                        var from = door.get_FromRoom(phase);
                        var to = door.get_ToRoom(phase);
                        doors.Add(new {
                            doorId = door.Id.Value, nativeDoorUniqueId = door.UniqueId,
                            phaseUniqueId = phase.UniqueId, nativeLevelId = door.LevelId.Value,
                            hostId = door.Host?.Id.Value, fromNativeRoomUniqueId = from?.UniqueId,
                            toNativeRoomUniqueId = to?.UniqueId,
                            pointFeet = door.Location is LocationPoint lp ? new[] { lp.Point.X, lp.Point.Y, lp.Point.Z } : null,
                            family = door.Symbol.FamilyName, type = door.Name
                        });
                    }
                    catch (Exception ex) { diagnostics.Add(new { nativeDoorUniqueId = door.UniqueId, phaseUniqueId = phase.UniqueId, code = "door-phase-export-failed", detail = ex.Message }); }
                }
            var links = new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().Select(link => new {
                nativeUniqueId = link.UniqueId, name = link.Name, loaded = link.GetLinkDocument() is not null
            }).ToArray();
            if (links.Length > 0) diagnostics.Add(new { code = "linked-models-not-exported", detail = "Host-only inventory. Linked semantic boundaries need explicit transforms and model identities; do not map them blindly." });
            var payload = new {
                format = "reviter-revit-finish-inventory", version = 1, sourceModelSha256 = digest,
                units = "feet", coordinateSystem = "revit-internal", boundaryLocation = "finish",
                exporter = "Reviter.SemanticExport/1; Revit " + commandData.Application.Application.VersionNumber,
                curveSampling = "Revit Curve.Tessellate; original endpoints; no boundary gap closure",
                sourceFileName = Path.GetFileName(doc.PathName), rooms, doors,
                boundarySupport = boundarySupport.Values.ToArray(), links, diagnostics
            };
            File.WriteAllText(dialog.FileName, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }));
            TaskDialog.Show("Reviter", $"Exported {rooms.Count} room inventories and {doors.Count} phase-specific door records.\n{diagnostics.Count} diagnostics. Model unchanged.\nMap native room identities explicitly before preparing the indoor project.");
            return Result.Succeeded;
        }
        catch (Exception ex) { message = ex.Message; return Result.Failed; }
    }
}
