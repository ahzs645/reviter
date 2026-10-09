/**********************************************************************
 *
 * GEOS - Geometry Engine Open Source
 * http://geos.osgeo.org
 *
 * Copyright (C) 2020 Paul Ramsey <pramsey@cleverelephant.ca>
 *
 * This is free software; you can redistribute and/or modify it under
 * the terms of the GNU Lesser General Public Licence as published
 * by the Free Software Foundation.
 * See the COPYING file for more information.
 *
 **********************************************************************/

#include <geos/noding/snap/SnappingPointIndex.h>

extern bool native_snap_audit(double,double,double,double,int);
#include <algorithm>
#include <limits>
#include <cmath>
using namespace geos::geom;

namespace geos {
namespace noding { // geos.noding
namespace snap { // geos.noding.snap

SnappingPointIndex::SnappingPointIndex(double p_snapTolerance) :
    snapTolerance(p_snapTolerance),
    snapPointIndex(new index::kdtree::KdTree(0)) {}


const Coordinate&
SnappingPointIndex::snap(const Coordinate& p)
{
    /**
    * Inserting the coordinate snaps it to any existing
    * one within tolerance, or adds it if not.
    */
    // Keep an exact spatial inventory, including each declined original point.
    auto candidates=snapPointIndex->query(Envelope(p.x-snapTolerance,p.x+snapTolerance,p.y-snapTolerance,p.y+snapTolerance));
    index::kdtree::KdNode* best=nullptr;double bestDistance=snapTolerance;
    for(auto* candidate:*candidates){const auto& q=candidate->getCoordinate();const double distance=p.distance(q);if(distance>snapTolerance)continue;if(distance==0)return q;
        const double local=4*std::numeric_limits<double>::epsilon()*std::max({1.0,std::abs(p.x),std::abs(p.y),std::abs(q.x),std::abs(q.y)});
        if(distance>local){native_snap_audit(p.x,p.y,q.x,q.y,1);continue;}
        if(!best||distance<bestDistance||(distance==bestDistance&&(q.x<best->getX()||(q.x==best->getX()&&q.y<best->getY())))){best=candidate;bestDistance=distance;}
    }
    if(best){const auto& q=best->getCoordinate();if(native_snap_audit(p.x,p.y,q.x,q.y,1))return q;}
    return snapPointIndex->insert(p)->getCoordinate();
}



} // namespace geos.noding.snap
} // namespace geos.noding
} // namespace geos
