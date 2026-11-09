"""Local-only API + built React client. Key is read by backend from env/.env."""
import sys
import os
from pathlib import Path

project=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(project / "backend"))
from fastapi.staticfiles import StaticFiles
from app.main import app
import uvicorn

dist=project / "frontend" / "dist"
if dist.exists():
    app.mount("/",StaticFiles(directory=dist,html=True),name="frontend")

if __name__=="__main__":
    uvicorn.run(app,host="0.0.0.0",port=int(os.environ.get("PORT", "8000")),workers=1,access_log=False)
