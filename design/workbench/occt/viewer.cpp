// OCCT-native browser viewport. Domain data and approval stay in the host.
#include <emscripten/bind.h>
#include <AIS_InteractiveContext.hxx>
#include <AIS_Shape.hxx>
#include <Aspect_DisplayConnection.hxx>
#include <BRepTools.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <Poly_Triangulation.hxx>
#include <Poly_Triangle.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <Bnd_Box.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <Graphic3d_ClipPlane.hxx>
#include <Graphic3d_ArrayOfTriangles.hxx>
#include <Graphic3d_Group.hxx>
#include <Prs3d_ShadingAspect.hxx>
#include <PrsMgr_PresentationManager.hxx>
#include <Graphic3d_MaterialAspect.hxx>
#include <OpenGl_GraphicDriver.hxx>
#include <Prs3d_Drawer.hxx>
#include <Prs3d_LineAspect.hxx>
#include <Graphic3d_ZLayerId.hxx>
#include <Standard_Failure.hxx>
#include <StdSelect_BRepOwner.hxx>
#include <Select3D_SensitiveTriangulation.hxx>
#include <SelectMgr_Selection.hxx>
#include <SelectMgr_ViewerSelector.hxx>
#include <TopExp.hxx>
#include <TopoDS.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <V3d_View.hxx>
#include <V3d_Viewer.hxx>
#include <Wasm_Window.hxx>
#include <gp_Pln.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Circ.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <cmath>
#include <cstdlib>
#include <algorithm>
#include <sstream>
#include <chrono>
#include <string>
#include <vector>

using emscripten::val;
namespace {
struct MeshPickPrototype {
  Handle(Poly_Triangulation) poly;
  gp_Pnt center;
  std::vector<TopLoc_Location> instances;
};
// Rigid copies share the same triangle indices and already built local-space BVH.
// Hit testing still uses every displayed triangle, with the instance's inverse location.
class SharedMeshSensitive : public Select3D_SensitiveTriangulation {
public:
  SharedMeshSensitive(const Handle(SelectMgr_EntityOwner)& owner,const Handle(Poly_Triangulation)& poly,const gp_Pnt& center)
    :Select3D_SensitiveTriangulation(owner,poly,TopLoc_Location(),Handle(TColStd_HArray1OfInteger)(),center,true){}
  SharedMeshSensitive(const Handle(SelectMgr_EntityOwner)& owner,const Handle(SharedMeshSensitive)& prototype,const TopLoc_Location& location,const gp_Pnt& center)
    :Select3D_SensitiveTriangulation(owner,prototype->Triangulation(),location,Handle(TColStd_HArray1OfInteger)(),center,true),prototype_(prototype){
    myBVHPrimIndexes=prototype->myBVHPrimIndexes;myContent=prototype->myContent;
  }
private:
  Handle(SharedMeshSensitive) prototype_;
};
class MeshDisplayShape : public AIS_Shape {
public:
  MeshDisplayShape(const TopoDS_Shape& shape,const std::vector<MeshPickPrototype>& prototypes):AIS_Shape(shape),prototypes_(prototypes){
    for(const auto& p:prototypes_){Bnd_Box box;for(Standard_Integer i=1;i<=p.poly->NbNodes();i++)box.Add(p.poly->Node(i));
      for(const auto& location:p.instances)myBB.Add(box.Transformed(location.Transformation()));}
  }
  const Bnd_Box& BoundingBox() override {return myBB;}
  void BoundingBox(Bnd_Box& box) override {box.Add(myBB.Transformed(Transformation()));}
protected:
  void Compute(const Handle(PrsMgr_PresentationManager)&,const Handle(Prs3d_Presentation)& presentation,const Standard_Integer mode) override {
    if(mode!=AIS_Shaded)return;
    for(const auto& p:prototypes_){
      const Handle(Graphic3d_ArrayOfTriangles) triangles=new Graphic3d_ArrayOfTriangles(p.poly->NbNodes(),p.poly->NbTriangles()*3,true);
      for(Standard_Integer i=1;i<=p.poly->NbNodes();i++)triangles->AddVertex(p.poly->Node(i),p.poly->Normal(i));
      for(Standard_Integer i=1;i<=p.poly->NbTriangles();i++){
        Standard_Integer a,b,c;p.poly->Triangle(i).Get(a,b,c);
        triangles->AddEdge(a);triangles->AddEdge(b);triangles->AddEdge(c);
      }
      // One immutable triangle buffer per prototype; OCCT transforms each group
      // at draw time. Copies keep their actual rigid placements and clipping.
      for(const auto& location:p.instances){
        const auto group=presentation->NewGroup();group->SetClosed(true);
        group->SetTransformation(location.Transformation());
        group->SetGroupPrimitivesAspect(myDrawer->ShadingAspect()->Aspect());group->AddPrimitiveArray(triangles);
      }
    }
  }
  void ComputeSelection(const Handle(SelectMgr_Selection)& selection,const Standard_Integer mode) override {
    if(mode!=0)return;
    const Handle(StdSelect_BRepOwner) owner=new StdSelect_BRepOwner(Shape(),this,5,false);
    for(const auto& p:prototypes_){
      const Handle(SharedMeshSensitive) prototype=new SharedMeshSensitive(Handle(SelectMgr_EntityOwner)(),p.poly,p.center);prototype->BVH();
      for(const auto& location:p.instances)selection->Add(new SharedMeshSensitive(owner,prototype,location,p.center));
    }
  }
private:
  std::vector<MeshPickPrototype> prototypes_;
};
struct Part {
  Handle(AIS_Shape) display;
  TopoDS_Shape shape;
  Handle(Graphic3d_ClipPlane) peel;
  double length;
  double innerRadius,outerRadius,wireDiameter;
  bool fineEdges=false;
  bool meshDisplay=false;
};
Handle(OpenGl_GraphicDriver) driver;
Handle(V3d_Viewer) viewer;
Handle(V3d_View) view;
Handle(Wasm_Window) window;
Handle(AIS_InteractiveContext) context;
std::vector<Part> parts;
int active = -1, pickMode = 0;
int hovered=-1,outlined=-1,hoverOutlined=-1;
bool interacting=false;
Handle(AIS_Shape) selectedOutline,hoverOutline;
Quantity_Color selectedColor(.16,.19,.21,Quantity_TOC_sRGB),hoverColor(.28,.30,.32,Quantity_TOC_sRGB);
double outlinedLength=-1,hoverLength=-1,heading=-.78539816339;
bool pairMeasure = false, hasMeasureStart = false;
gp_Pnt measureStart;
std::string layout = "peel";
std::string selectionKind="part";
double diameter = 1, cableLength=1, yaw=0, elevation=.6154797, zoomLevel=1, panX=0, panY=0, sectionPosition=.55;

void redraw() { if (!view.IsNull()) view->Redraw(); }
double visibleLength(size_t i){return parts[i].length*(layout=="section"?sectionPosition:layout=="peel"?1.-static_cast<double>(i)/std::max<size_t>(1,parts.size()-1)*.55:1.);}
void outline(Handle(AIS_Shape)& object,int& cached,double& cachedLength,int index,const Quantity_Color& color){
  if(index<0||static_cast<size_t>(index)>=parts.size()){if(!object.IsNull())context->Erase(object,false);cached=-1;return;}
  const auto& p=parts[index];const double end=visibleLength(index);
  if(index!=cached||std::abs(cachedLength-end)>1e-6){
    if(!object.IsNull())context->Remove(object,false);
    BRep_Builder builder;TopoDS_Compound edges;builder.MakeCompound(edges);
    for(double z:{0.,end}){builder.Add(edges,BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0,0,z),gp_Dir(0,0,1)),p.outerRadius)).Edge());
      if(p.innerRadius>0)builder.Add(edges,BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0,0,z),gp_Dir(0,0,1)),p.innerRadius)).Edge());}
    for(double x:{-p.outerRadius,p.outerRadius})builder.Add(edges,BRepBuilderAPI_MakeEdge(gp_Pnt(x,0,0),gp_Pnt(x,0,end)).Edge());
    object=new AIS_Shape(edges);object->SetDisplayMode(AIS_WireFrame);object->SetColor(color);object->SetWidth(1.5);
    object->Attributes()->SetLineAspect(new Prs3d_LineAspect(color,Aspect_TOL_SOLID,1.5));
    object->SetZLayer(Graphic3d_ZLayerId_Topmost);cached=index;cachedLength=end;
  }
  context->Display(object,false);context->Deactivate(object);
  gp_Trsf location;location.SetRotation(gp_Ax1(gp_Pnt(),gp_Dir(0,0,1)),heading+1.57079632679);
  context->SetLocation(object,TopLoc_Location(location));
}
void updateOutlines(){outline(selectedOutline,outlined,outlinedLength,active,selectedColor);outline(hoverOutline,hoverOutlined,hoverLength,interacting||hovered==active?-1:hovered,hoverColor);}
void fineEdges(){
  int leftX,leftY,rightX,rightY;view->Convert(-diameter/2,0,0,leftX,leftY);view->Convert(diameter/2,0,0,rightX,rightY);
  const double diameterPixels=std::hypot(rightX-leftX,rightY-leftY);
  for(auto& p:parts){const double pixels=diameterPixels*p.wireDiameter/diameter;
    const bool detailed=!p.meshDisplay&&p.wireDiameter>0&&!interacting&&(p.fineEdges?pixels>4:pixels>6);
    if(detailed!=p.fineEdges){p.fineEdges=detailed;p.display->Attributes()->SetFaceBoundaryDraw(detailed);context->Redisplay(p.display,false);}}
}
void activateSelection(){
  for(size_t i=0;i<parts.size();++i){auto& p=parts[i];context->Deactivate(p.display);
    if(selectionKind=="diameter" && active>=0 && static_cast<int>(i)!=active)continue;
    if(context->IsDisplayed(p.display)){context->Activate(p.display,pickMode,true);
      if(selectionKind=="point")context->Activate(p.display,AIS_Shape::SelectionMode(TopAbs_VERTEX),true);
      if(selectionKind=="diameter")context->Activate(p.display,AIS_Shape::SelectionMode(TopAbs_EDGE),true);}
  }
}
void applyLayout() {
  for (size_t i=0; i<parts.size(); ++i) {
    auto& p = parts[i];
    // Re-displaying an already visible actor with automatic activation disabled
    // applies selection mode -1. Layout changes must preserve its active modes.
    if(!context->IsDisplayed(p.display))context->Display(p.display,false);
    const double fraction=1.0-(static_cast<double>(i)/std::max<size_t>(1,parts.size()-1))*.55;
    p.peel->SetEquation(gp_Pln(gp_Pnt(0,0,p.length*(layout=="section"?sectionPosition:fraction)),gp_Dir(0,0,-1)));
    p.peel->SetOn(layout=="section" || (layout=="peel" && i>0));
    context->SetTransparency(p.display,active>=0 && static_cast<int>(i)!=active?.70:0.,false);
    gp_Trsf trsf;trsf.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(0,0,1)),yaw);
    context->SetLocation(p.display,TopLoc_Location(trsf));
  }
  updateOutlines();
}
void camera(double azimuth,double angle,double zoom,double px,double py,double directionHeading) {
  if(view.IsNull())return;
  yaw=azimuth;elevation=std::clamp(angle,-.7,1.57079632679);zoomLevel=std::clamp(zoom,.65,3.);
  panX=std::clamp(px,-.28,.28);panY=std::clamp(py,-.28,.28);
  heading=directionHeading;
  view->SetProj(std::cos(elevation)*std::cos(heading),std::cos(elevation)*std::sin(heading),std::sin(elevation));view->SetUp(0,1,0);
  Bnd_Box box;box.Update(-diameter/2,-diameter/2,0,diameter/2,diameter/2,cableLength);
  view->FitAll(box,.18,false);
  auto cam=view->Camera();cam->SetScale(cam->Scale()/zoomLevel);
  const gp_Vec focusShift(0,0,layout=="section"?cableLength*(sectionPosition-1)/2:0);
  const gp_Dir direction=cam->Direction(),up=cam->Up();const gp_Vec right=gp_Vec(direction).Crossed(gp_Vec(up));
  const gp_Vec shift=focusShift+right*(panX*cam->Scale()*cam->Aspect())+gp_Vec(up)*(panY*cam->Scale());
  const auto eye=cam->Eye(),center=cam->Center();cam->SetEye(eye.Translated(shift));cam->SetCenter(center.Translated(shift));
  for(auto& p:parts){gp_Trsf trsf;trsf.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(0,0,1)),yaw);context->SetLocation(p.display,TopLoc_Location(trsf));}
  updateOutlines();fineEdges();
  redraw();
}
val failure(const std::string& message) { val v=val::object();v.set("error",message);return v; }
}

val initialize(const std::string& canvasId, double r, double g, double b) {
  try {
    if (!context.IsNull()) {view->SetBackgroundColor(Quantity_Color(r,g,b,Quantity_TOC_sRGB));return val(true);}
    setenv("CSF_ShadersDirectory","/occt/shaders",1);
    driver = new OpenGl_GraphicDriver(Handle(Aspect_DisplayConnection)(),false);
    driver->ChangeOptions().buffersNoSwap=true;
    driver->ChangeOptions().buffersOpaqueAlpha=true;
    if (!driver->InitContext()) return failure("无法创建 WebGL 2 CAD 上下文");
    viewer = new V3d_Viewer(driver);
    viewer->SetDefaultLights();viewer->SetLightOn();
    viewer->SetDefaultShadingModel(Graphic3d_TypeOfShadingModel_Phong);
    view = viewer->CreateView();
    view->SetImmediateUpdate(false);
    view->ChangeRenderingParams().NbMsaaSamples=4;
    window = new Wasm_Window(TCollection_AsciiString(("#"+canvasId).c_str()),false);
    view->SetWindow(window);
    view->SetBackgroundColor(Quantity_Color(r,g,b,Quantity_TOC_sRGB));
    context = new AIS_InteractiveContext(viewer);
    context->SetPixelTolerance(12);
    context->SetAutoActivateSelection(false);
    context->SetAutomaticHilight(false);
    context->SetToHilightSelected(false);
    view->SetProj(1,-1,1);view->SetUp(0,1,0);
    return val(true);
  } catch (const Standard_Failure& e) { return failure(e.GetMessageString()); }
}

void clearModel() {
  if (context.IsNull()) return;
  context->RemoveAll(false);parts.clear();active=hovered=outlined=hoverOutlined=-1;selectedOutline.Nullify();hoverOutline.Nullify();interacting=false;
  hasMeasureStart=false;pairMeasure=false;redraw();
}

double profileNow(){return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}
double lastParseMs=0,lastMeshMs=0,lastDisplayMs=0,lastPresentationMs=0,lastSelectionMs=0;
val partTimings(){val v=val::object();v.set("parse_ms",lastParseMs);v.set("mesh_ms",lastMeshMs);v.set("display_ms",lastDisplayMs);v.set("presentation_ms",lastPresentationMs);v.set("selection_ms",lastSelectionMs);return v;}
val displayPart(const TopoDS_Shape& shape,double r,double g,double b,bool metallic,double length,double innerRadius,double outerRadius,double wireDiameter,bool meshDisplay=false,const std::vector<MeshPickPrototype>& prototypes={}){
  const auto displayAt=profileNow();
  Handle(AIS_Shape) object=meshDisplay?Handle(AIS_Shape)(new MeshDisplayShape(shape,prototypes)):Handle(AIS_Shape)(new AIS_Shape(shape));
  object->SetDisplayMode(AIS_Shaded);
  Quantity_Color color(r,g,b,Quantity_TOC_sRGB);
  object->SetMaterial(Graphic3d_MaterialAspect(metallic?Graphic3d_NameOfMaterial_Steel:Graphic3d_NameOfMaterial_Plastified));
  object->SetColor(color);
  object->SetOwnDeviationCoefficient(.0012);object->SetOwnDeviationAngle(.35);
  object->Attributes()->SetFaceBoundaryDraw(false);
  Handle(Graphic3d_ClipPlane) peel=new Graphic3d_ClipPlane();
  peel->SetCapping(true);peel->SetCappingColor(color);peel->SetUseObjectMaterial(true);peel->SetCappingHatchOff();peel->SetOn(false);
  object->AddClipPlane(peel);
  parts.push_back({object,shape,peel,length,innerRadius,outerRadius,wireDiameter,false,meshDisplay});
  context->Display(object,AIS_Shaded,pickMode,false);lastPresentationMs=profileNow()-displayAt;
  const auto selectionAt=profileNow();context->Activate(object,pickMode,true);lastSelectionMs=profileNow()-selectionAt;
  lastDisplayMs=profileNow()-displayAt;
  return val(static_cast<int>(parts.size()-1));
}
val addPart(const std::string& brep, double r, double g, double b, bool metallic, double length,double innerRadius,double outerRadius,double wireDiameter) {
  try {
    // One temporary slot is needed for an atomic replacement of a 32-layer model.
    if (context.IsNull() || brep.size()>8*1024*1024 || parts.size()>=33) return failure("模型或视口状态无效");
    const auto parseAt=profileNow();
    TopoDS_Shape shape;BRep_Builder builder;std::istringstream stream(brep);
    BRepTools::Read(shape,stream,builder);
    lastParseMs=profileNow()-parseAt;
    if (shape.IsNull()) return failure("B-Rep 实体读取失败");
    const auto meshAt=profileNow();BRepMesh_IncrementalMesh(shape,.08,false,.35);lastMeshMs=profileNow()-meshAt;
    return displayPart(shape,r,g,b,metallic,length,innerRadius,outerRadius,wireDiameter);
  } catch (const Standard_Failure& e) { return failure(e.GetMessageString()); }
}

// Display-only triangulations of the plugin's checked solids. Original BRep is
// loaded on demand before topology measurement; these proxies never leave the viewer.
val addMeshPart(const val& mesh,double r,double g,double b,bool metallic,double length,double inner,double outer,double wire){
  try{
    if(context.IsNull()||parts.size()>=33||mesh["schema"].as<std::string>()!="cablesim.display-mesh/1")return failure("显示网格无效");
    const auto parseAt=profileNow();BRep_Builder builder;TopoDS_Compound compound;builder.MakeCompound(compound);std::vector<MeshPickPrototype> pickingPrototypes;
    auto groups=mesh["prototypes"];const auto n=groups["length"].as<unsigned>();
    for(unsigned g=0;g<n;g++){
      const auto item=groups[g];const auto points=emscripten::convertJSArrayToNumberVector<double>(item["positions"]);
      const auto triangles=emscripten::convertJSArrayToNumberVector<int>(item["triangles"]);
      if(points.empty()||points.size()%3||triangles.empty()||triangles.size()%3||points.size()>3000000)return failure("显示网格数组无效");
      Handle(Poly_Triangulation) poly=new Poly_Triangulation(points.size()/3,triangles.size()/3,false,true);
      for(size_t i=0;i<points.size()/3;i++)poly->SetNode(i+1,gp_Pnt(points[i*3],points[i*3+1],points[i*3+2]));
      for(size_t i=0;i<triangles.size()/3;i++){
        for(unsigned k=0;k<3;k++)if(triangles[i*3+k]<0||static_cast<size_t>(triangles[i*3+k])>=points.size()/3)return failure("显示网格索引无效");
        poly->SetTriangle(i+1,Poly_Triangle(triangles[i*3]+1,triangles[i*3+1]+1,triangles[i*3+2]+1));
      }
      poly->Deflection(.08);poly->ComputeNormals();
      gp_XYZ center;for(Standard_Integer i=1;i<=poly->NbNodes();i++)center+=poly->Node(i).XYZ();center/=poly->NbNodes();
      MeshPickPrototype picking{poly,gp_Pnt(center),{}};
      TopoDS_Face face;builder.MakeFace(face,poly);TopoDS_Shell shell;builder.MakeShell(shell);builder.Add(shell,face);shell.Closed(true);
      TopoDS_Solid solid;builder.MakeSolid(solid);builder.Add(solid,shell);solid.Closed(true);
      const auto instances=item["instances"];const auto count=instances["length"].as<unsigned>();
      for(unsigned j=0;j<count;j++){
        const auto t=emscripten::convertJSArrayToNumberVector<double>(instances[j]);if(t.size()!=12)return failure("显示网格变换无效");
        gp_Trsf location;location.SetValues(t[0],t[1],t[2],t[3],t[4],t[5],t[6],t[7],t[8],t[9],t[10],t[11]);
        picking.instances.push_back(TopLoc_Location(location));
        builder.Add(compound,solid.Moved(TopLoc_Location(location)));
      }
      pickingPrototypes.push_back(picking);
    }
    lastParseMs=profileNow()-parseAt;lastMeshMs=0;
    return displayPart(compound,r,g,b,metallic,length,inner,outer,wire,true,pickingPrototypes);
  }catch(const Standard_Failure& e){return failure(e.GetMessageString());}
}

// Build display-only annular envelopes in the already mounted OCCT context.
// Exact geometry, measurements, quantities and STEP remain plugin-owned.
val envelopeBrep(double inner,double outer,double length){
  try{
    if(inner<0||outer<=inner||length<=0)return failure("包络尺寸无效");
    BRepBuilderAPI_Sewing sewing(1e-6);
    sewing.Add(BRepBuilderAPI_MakeFace(gp_Cylinder(gp_Ax3(),outer),0,2*M_PI,0,length).Face());
    if(inner>0){auto face=BRepBuilderAPI_MakeFace(gp_Cylinder(gp_Ax3(),inner),0,2*M_PI,0,length).Face();face.Reverse();sewing.Add(face);}
    for(double z:{0.,length}){
      auto outerWire=BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0,0,z),gp_Dir(0,0,1)),outer)).Edge()).Wire();
      BRepBuilderAPI_MakeFace cap(gp_Pln(gp_Pnt(0,0,z),gp_Dir(0,0,1)),outerWire,true);
      if(inner>0){auto innerWire=BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0,0,z),gp_Dir(0,0,1)),inner)).Edge()).Wire();innerWire.Reverse();cap.Add(innerWire);}
      auto face=cap.Face();if(z==0)face.Reverse();sewing.Add(face);
    }
    sewing.Perform();auto shell=TopoDS::Shell(sewing.SewedShape());auto solid=BRepBuilderAPI_MakeSolid(shell).Solid();
    std::ostringstream stream;BRepTools::Write(solid,stream);return val(stream.str());
  }catch(const Standard_Failure& e){return failure(e.GetMessageString());}
}
val commitReplacement(int index,const val& result){
  if(result.typeOf().as<std::string>()=="object")return result;
  auto replacement=parts.back();parts.pop_back();
  replacement.peel->SetEquation(parts[index].peel->GetEquation());replacement.peel->SetOn(parts[index].peel->IsOn());
  context->SetTransparency(replacement.display,parts[index].display->Transparency(),false);
  gp_Trsf location;location.SetRotation(gp_Ax1(gp_Pnt(),gp_Dir(0,0,1)),yaw);context->SetLocation(replacement.display,TopLoc_Location(location));
  context->Remove(parts[index].display,false);parts[index]=replacement;
  outlined=hoverOutlined=-1;hovered=-1;hasMeasureStart=false;return val(true);
}
val replacePart(int index,const std::string& brep,double r,double g,double b,bool metallic,double length,double inner,double outer,double wire){
  if(index<0||static_cast<size_t>(index)>=parts.size())return failure("结构层不存在");
  // Keep the old shape until its replacement has been parsed and displayed.
  auto result=addPart(brep,r,g,b,metallic,length,inner,outer,wire);
  return commitReplacement(index,result);
}
val replaceMeshPart(int index,const val& mesh,double r,double g,double b,bool metallic,double length,double inner,double outer,double wire){
  if(index<0||static_cast<size_t>(index)>=parts.size())return failure("结构层不存在");
  return commitReplacement(index,addMeshPart(mesh,r,g,b,metallic,length,inner,outer,wire));
}

void finishModel(double outerDiameter, const std::string& mode) {
  diameter=outerDiameter;cableLength=parts.empty()?1:parts[0].length;layout=mode;applyLayout();camera(yaw,elevation,zoomLevel,panX,panY,heading);
}
void resize() { if (!view.IsNull()) { window->DoResize();view->MustBeResized();camera(yaw,elevation,zoomLevel,panX,panY,heading); } }
void fit(const std::string& direction) {
  if (view.IsNull()) return;
  camera(yaw,direction=="end"?1.57079632679:direction=="front"?0:.6154797,1,0,0,heading);
}
void selectPart(int i) {
  if (i<0 || static_cast<size_t>(i)>=parts.size()) return;
  active=i;context->ClearSelected(false);applyLayout();activateSelection();redraw();
}
void setMode(const std::string& mode) {
  if (mode=="transparent" || mode=="peel" || mode=="section") {layout=mode;applyLayout();camera(yaw,elevation,zoomLevel,panX,panY,heading);}
}
void setSelectionMode(const std::string& mode) {
  selectionKind=mode;
  pickMode=(mode=="face"||mode=="diameter")?AIS_Shape::SelectionMode(TopAbs_FACE):(mode=="edge"||mode=="point")?AIS_Shape::SelectionMode(TopAbs_EDGE):mode=="vertex"?AIS_Shape::SelectionMode(TopAbs_VERTEX):0;
  context->ClearSelected(false);hasMeasureStart=false;
  activateSelection();
  redraw();
}
void finishUpdate(double outerDiameter,const std::string& mode,int selectedIndex,const std::string& selection,double fraction){
  diameter=outerDiameter;cableLength=parts.empty()?1:parts[0].length;layout=mode;
  active=selectedIndex;sectionPosition=std::clamp(fraction,.05,.95);selectionKind=selection;
  pickMode=(selection=="diameter")?AIS_Shape::SelectionMode(TopAbs_FACE):selection=="point"?AIS_Shape::SelectionMode(TopAbs_EDGE):0;
  hasMeasureStart=false;applyLayout();activateSelection();
}
void setSection(double fraction){sectionPosition=std::clamp(fraction,.05,.95);applyLayout();camera(yaw,elevation,zoomLevel,panX,panY,heading);}
val project(double x,double y,double z){gp_Pnt p(x,y,z);gp_Trsf trsf;trsf.SetRotation(gp_Ax1(gp_Pnt(),gp_Dir(0,0,1)),yaw);p.Transform(trsf);int px,py;view->Convert(p.X(),p.Y(),p.Z(),px,py);val v=val::object();v.set("x",px);v.set("y",py);return v;}
bool hitTest(int x,int y){context->MoveTo(x,y,view,false);return context->HasDetected();}
void hover(int x,int y) {
  int next=-1;
  if(x<0||y<0||interacting)context->ClearDetected(false);
  else{context->MoveTo(x,y,view,false);if(context->HasDetected()){const auto object=context->DetectedInteractive();for(size_t i=0;i<parts.size();++i)if(parts[i].display==object)next=static_cast<int>(i);}}
  if(next!=hovered){hovered=next;updateOutlines();redraw();}
}
void setInteracting(bool value){interacting=value;if(value){hovered=-1;context->ClearDetected(false);}updateOutlines();fineEdges();redraw();}
void outlineColors(double sr,double sg,double sb,double hr,double hg,double hb){selectedColor=Quantity_Color(sr,sg,sb,Quantity_TOC_sRGB);hoverColor=Quantity_Color(hr,hg,hb,Quantity_TOC_sRGB);}
val viewportInfo(){
  val value=val::object();value.set("layers",parts.size());value.set("selected",active);value.set("hovered",hovered);value.set("interacting",interacting);
  value.set("selection_kind",selectionKind);value.set("msaa_samples",view->RenderingParams().NbMsaaSamples);
  int edges=0,precise=0;for(auto& p:parts){if(p.fineEdges)++edges;if(!p.meshDisplay)++precise;}
  value.set("fine_edge_layers",edges);value.set("original_topology_layers",precise);
  Standard_Integer width,height;window->Size(width,height);value.set("window_width",width);value.set("window_height",height);
  val modes=val::array();if(active>=0&&static_cast<size_t>(active)<parts.size()){
    const auto& object=parts[active].display;TColStd_ListOfInteger activated;context->ActivatedModes(object,activated);
    for(TColStd_ListOfInteger::Iterator it(activated);it.More();it.Next()){
      val mode=val::object();mode.set("mode",it.Value());mode.set("active",context->MainSelector()->IsActive(object,it.Value()));mode.set("entities",object->HasSelection(it.Value())?object->Selection(it.Value())->Entities().Size():0);modes.call<void>("push",mode);
    }
  }
  value.set("selected_selection_modes",modes);
  return value;
}
void measurePair(bool enabled) {pairMeasure=enabled;hasMeasureStart=false;}

val pick(int x,int y) {
  try {
    context->MoveTo(x,y,view,false);
    if (!context->HasDetected()) {context->ClearSelected(false);redraw();return val::null();}
    context->SelectDetected(AIS_SelectionScheme_Replace);
    context->InitSelected();
    if (!context->MoreSelected()) {redraw();return val::null();}
    auto selected=context->SelectedInteractive();
    int part=-1;
    for (size_t i=0;i<parts.size();++i) if (parts[i].display==selected) part=static_cast<int>(i);
    if (part<0) return val::null();
    active=part;
    val result=val::object();result.set("part",part);
    const auto owner=Handle(StdSelect_BRepOwner)::DownCast(context->SelectedOwner());
    TopoDS_Shape shape=!owner.IsNull()?owner->Shape():parts[part].shape;
    TopTools_IndexedMapOfShape map;TopExp::MapShapes(parts[part].shape,shape.ShapeType(),map);
    int topology=map.FindIndex(shape);
    if(topology)shape=map(topology);
    result.set("index",topology);
    if (pickMode==0) result.set("kind","part");
    else if(shape.ShapeType()==TopAbs_FACE) {
      result.set("kind","face");
      const auto face=TopoDS::Face(shape);GProp_GProps props;BRepGProp::SurfaceProperties(face,props);
      result.set("area_mm2",props.Mass());
      BRepAdaptor_Surface surface(face);
      if(surface.GetType()==GeomAbs_Cylinder) {result.set("radius_mm",surface.Cylinder().Radius());result.set("diameter_mm",surface.Cylinder().Radius()*2);}
      result.set("surface",surface.GetType()==GeomAbs_Cylinder?"cylinder":surface.GetType()==GeomAbs_Plane?"plane":"other");
    } else if(shape.ShapeType()==TopAbs_EDGE) {
      result.set("kind","edge");
      const auto edge=TopoDS::Edge(shape);GProp_GProps props;BRepGProp::LinearProperties(edge,props);
      result.set("length_mm",props.Mass());BRepAdaptor_Curve curve(edge);
      if(curve.GetType()==GeomAbs_Circle) {result.set("radius_mm",curve.Circle().Radius());result.set("diameter_mm",curve.Circle().Radius()*2);}
    } else if(shape.ShapeType()==TopAbs_VERTEX) {
      result.set("kind","vertex");const auto p=BRep_Tool::Pnt(TopoDS::Vertex(shape));
      result.set("x_mm",p.X());result.set("y_mm",p.Y());result.set("z_mm",p.Z());
    }
    if(pairMeasure) {
      gp_Pnt point;bool snapped=false;
      if(shape.ShapeType()==TopAbs_VERTEX){point=BRep_Tool::Pnt(TopoDS::Vertex(shape));snapped=true;}
      else if(shape.ShapeType()==TopAbs_EDGE){
        double ox,oy,oz,dx,dy,dz;view->ConvertWithProj(x,y,ox,oy,oz,dx,dy,dz);
        gp_Trsf undo;undo.SetRotation(gp_Ax1(gp_Pnt(),gp_Dir(0,0,1)),-yaw);
        gp_Pnt origin(ox,oy,oz);origin.Transform(undo);gp_Vec direction(dx,dy,dz);direction.Transform(undo);
        const double span=std::max(cableLength,diameter)*20;
        auto ray=BRepBuilderAPI_MakeEdge(origin.Translated(direction*(-span)),origin.Translated(direction*span)).Edge();
        BRepExtrema_DistShapeShape distance(shape,ray);if(distance.IsDone()&&distance.NbSolution()){point=distance.PointOnShape1(1);snapped=true;}
      }
      if(snapped){result.set("x_mm",point.X());result.set("y_mm",point.Y());result.set("z_mm",point.Z());if(!hasMeasureStart){measureStart=point;hasMeasureStart=true;result.set("measure_pending",true);}else{result.set("distance_mm",measureStart.Distance(point));hasMeasureStart=false;}}
      else result.set("measurement_error","请选择边或顶点以捕捉测量端点");
    }
    context->ClearSelected(false);applyLayout();
    redraw();return result;
  } catch(const Standard_Failure& e) {return failure(e.GetMessageString());}
}
EMSCRIPTEN_BINDINGS(cablesim_occt_viewer) {
  emscripten::function("initialize",&initialize);
  emscripten::function("clearModel",&clearModel);
  emscripten::function("addPart",&addPart);
    emscripten::function("addMeshPart",&addMeshPart);
    emscripten::function("replaceMeshPart",&replaceMeshPart);
    emscripten::function("partTimings",&partTimings);
  emscripten::function("replacePart",&replacePart);
  emscripten::function("envelopeBrep",&envelopeBrep);
  emscripten::function("finishModel",&finishModel);
  emscripten::function("finishUpdate",&finishUpdate);
  emscripten::function("resize",&resize);
  emscripten::function("fit",&fit);
  emscripten::function("selectPart",&selectPart);
  emscripten::function("setMode",&setMode);
  emscripten::function("setSelectionMode",&setSelectionMode);
  emscripten::function("camera",&camera);
  emscripten::function("setSection",&setSection);
  emscripten::function("project",&project);
  emscripten::function("hitTest",&hitTest);
  emscripten::function("hover",&hover);
  emscripten::function("pick",&pick);
  emscripten::function("measurePair",&measurePair);
  emscripten::function("setInteracting",&setInteracting);
  emscripten::function("outlineColors",&outlineColors);
  emscripten::function("viewportInfo",&viewportInfo);
}

