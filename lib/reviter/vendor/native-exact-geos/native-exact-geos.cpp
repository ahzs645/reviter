#include <geos/io/GeoJSONReader.h>
#include <geos/io/GeoJSONWriter.h>
#include <geos/geom/Geometry.h>
#include <geos/geom/Envelope.h>
#include <geos/geom/PrecisionModel.h>
#include <geos/operation/overlayng/OverlayNG.h>
#include <geos/operation/overlayng/UnaryUnionNG.h>
#include <geos/noding/snap/SnappingNoder.h>
#include <geos/noding/ValidatingNoder.h>
#include <geos/noding/FastNodingValidator.h>
#include <geos/noding/SegmentString.h>
#include <geos/operation/union/UnaryUnionOp.h>
#include <geos/operation/union/UnionStrategy.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <sstream>
#include <iomanip>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <string>

// Candidate-only raw APIs remain unsnapped. Separate diagnostic APIs use a
// fixed SnappingNoder, audit every changed vertex/near-segment insertion, and
// reject numerical movement beyond local 4*EPSILON*coordinate magnitude.
static std::string last_error;
static std::ostringstream snap_records;
static std::size_t snap_count = 0;
static std::size_t snap_operand = 0;
static void reset_audit() { snap_records.str(""); snap_records.clear(); snap_count=0; }
bool native_snap_audit(double px,double py,double qx,double qy,int kind) {
    const double bound=4*std::numeric_limits<double>::epsilon()*std::max({1.0,std::abs(px),std::abs(py),std::abs(qx),std::abs(qy)});
    const double distance=std::hypot(px-qx,py-qy);
    if (snap_count++) snap_records << ",";
    snap_records << std::setprecision(17) << "{\"kind\":" << kind << ",\"operand\":" << snap_operand << ",\"p\":[" <<px<<","<<py<<"],\"q\":["<<qx<<","<<qy<<"],\"distance\":"<<distance<<",\"bound\":"<<bound<<",\"accepted\":"<<(distance<=bound?"true":"false")<<"}";
    return distance <= bound;
}
class CandidateIteratingNoder : public geos::noding::Noder {
 double tolerance; std::vector<geos::noding::SegmentString*>* result=nullptr;
 static void dispose(std::vector<geos::noding::SegmentString*>* lines){if(lines){for(auto* line:*lines)delete line;delete lines;}}
public:
 explicit CandidateIteratingNoder(double t):tolerance(t){}
 void computeNodes(std::vector<geos::noding::SegmentString*>* input) override {
  auto* current=input;
  for(int pass=0;pass<8;pass++){
   geos::noding::snap::SnappingNoder next(tolerance);next.computeNodes(current);auto* output=next.getNodedSubstrings();if(current!=input)dispose(current);current=output;
   geos::noding::FastNodingValidator validator(*current);if(validator.isValid()){result=current;return;}
   if(pass==7){try{validator.checkValid();}catch(...){dispose(current);throw;}}
  }
 }
 std::vector<geos::noding::SegmentString*>* getNodedSubstrings()const override{return result;}
};
static std::unique_ptr<geos::geom::Geometry> bounded_overlay(const geos::geom::Geometry* a,const geos::geom::Geometry*b,int op,double tolerance) {
    CandidateIteratingNoder noder(tolerance);
    geos::noding::ValidatingNoder validating(noder);
    const geos::geom::PrecisionModel floating;
    geos::operation::overlayng::OverlayNG overlay(a,b,&floating,op); overlay.setNoder(&validating); overlay.setOptimized(false); return overlay.getResult();
}
class RawUnoptimizedUnion : public geos::operation::geounion::UnionStrategy {
public:
 std::unique_ptr<geos::geom::Geometry> Union(const geos::geom::Geometry*a,const geos::geom::Geometry*b) override {const geos::geom::PrecisionModel floating;geos::operation::overlayng::OverlayNG overlay(a,b,&floating,geos::operation::overlayng::OverlayNG::UNION);overlay.setOptimized(false);return overlay.getResult();}
 bool isFloatingPrecision() const override {return true;}
};
class AuditedUnion : public geos::operation::geounion::UnionStrategy {
    double tolerance;
public:
    explicit AuditedUnion(double t):tolerance(t){}
    std::unique_ptr<geos::geom::Geometry> Union(const geos::geom::Geometry*a,const geos::geom::Geometry*b) override {return bounded_overlay(a,b,geos::operation::overlayng::OverlayNG::UNION,tolerance);}
    bool isFloatingPrecision() const override {return true;}
};
static char* copy_json(const geos::geom::Geometry* geometry) {
    geos::io::GeoJSONWriter writer;
    const std::string json = writer.write(geometry);
    char* result = static_cast<char*>(std::malloc(json.size() + 1));
    if (!result) throw std::bad_alloc();
    std::memcpy(result, json.c_str(), json.size() + 1);
    return result;
}
extern "C" {
char* native_snap_records() {
    const std::string json="["+snap_records.str()+"]";
    char* out=static_cast<char*>(std::malloc(json.size()+1));std::memcpy(out,json.c_str(),json.size()+1);return out;
}
char* native_bounded_snap_union(const char*a,double tolerance) {
    last_error.clear();reset_audit();snap_operand=0;
    try {geos::io::GeoJSONReader reader;auto g=reader.read(a);AuditedUnion strategy(tolerance);geos::operation::geounion::UnaryUnionOp op(*g);op.setUnionFunction(&strategy);auto result=op.Union();return copy_json(result.get());}
    catch(const std::exception&e){last_error=e.what();return nullptr;}
}
char* native_bounded_snap_overlay(const char*a,const char*b,int operation,double tolerance) {
    last_error.clear();reset_audit();snap_operand=0;
    try {geos::io::GeoJSONReader reader;auto left=reader.read(a),right=reader.read(b);auto result=bounded_overlay(left.get(),right.get(),operation,tolerance);return copy_json(result.get());}
    catch(const std::exception&e){last_error=e.what();return nullptr;}
}
char* native_bounded_snap_sequence(const char*a,const char*b,double tolerance) {
    last_error.clear();reset_audit();snap_operand=0;
    try {geos::io::GeoJSONReader reader;auto current=reader.read(a);const auto masks=reader.read(b);for(;snap_operand<masks->getNumGeometries();++snap_operand){const auto mask=masks->getGeometryN(snap_operand);if(!current->getEnvelopeInternal()->intersects(mask->getEnvelopeInternal()))continue;current=bounded_overlay(current.get(),mask,geos::operation::overlayng::OverlayNG::DIFFERENCE,tolerance);}return copy_json(current.get());}
    catch(const std::exception&e){last_error="operand #"+std::to_string(snap_operand)+": "+e.what();return nullptr;}
}
const char* native_last_error() { return last_error.c_str(); }
char* native_overlay(const char* a, const char* b, int operation) {
    last_error.clear();
    try {
        if (operation < 1 || operation > 4) throw std::runtime_error("Invalid overlay operation.");
        geos::io::GeoJSONReader reader;
        const auto left = reader.read(a), right = reader.read(b);
        const geos::geom::PrecisionModel floating;
        geos::operation::overlayng::OverlayNG overlay(left.get(),right.get(),&floating,operation);overlay.setOptimized(false);auto result=overlay.getResult();
        return copy_json(result.get());
    } catch (const std::exception& error) { last_error = error.what(); return nullptr; }
}
char* native_union(const char* a) {
    last_error.clear();
    try {
        geos::io::GeoJSONReader reader;
        const auto geometry = reader.read(a);
        const geos::geom::PrecisionModel floating;
        RawUnoptimizedUnion strategy;geos::operation::geounion::UnaryUnionOp op(*geometry);op.setUnionFunction(&strategy);auto result=op.Union();
        return copy_json(result.get());
    } catch (const std::exception& error) { last_error = error.what(); return nullptr; }
}
char* native_difference_sequence(const char* a, const char* b) {
    last_error.clear();
    std::size_t operand = 0;
    try {
        geos::io::GeoJSONReader reader;
        auto current = reader.read(a);
        const auto masks = reader.read(b);
        const geos::geom::PrecisionModel floating;
        for (; operand < masks->getNumGeometries(); ++operand) {
            const auto mask = masks->getGeometryN(operand);
            if (!current->getEnvelopeInternal()->intersects(mask->getEnvelopeInternal())) continue;
            geos::operation::overlayng::OverlayNG overlay(current.get(),mask,&floating,geos::operation::overlayng::OverlayNG::DIFFERENCE);overlay.setOptimized(false);current=overlay.getResult();
        }
        return copy_json(current.get());
    } catch (const std::exception& error) { last_error = "operand #" + std::to_string(operand) + ": " + error.what(); return nullptr; }
}
}
