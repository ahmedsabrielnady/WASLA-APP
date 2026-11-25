# Fail-closed guard for every test harness: only the wasla-test project may be contacted.
import re,os,glob
TEST_REF="mekeirlgmergmzsdkaon"
PROD_REF="yfgvimcqbtthnrbzbhft"
class GuardError(SystemExit):pass
def check_url(url):
    if url.rstrip("/")!=f"https://{TEST_REF}.supabase.co":
        raise GuardError(f"GUARD: refusing to run, URL is not the wasla-test project: {url[:60]}")
def check_config(root):
    """Static check of a UI copy: config.js must name exactly the test project and no source file may name production."""
    cfg=open(os.path.join(root,"src","config.js")).read()
    m=re.search(r'supabaseUrl:\s*"([^"]+)"',cfg)
    if not m:raise GuardError("GUARD: no supabaseUrl in config.js")
    check_url(m.group(1))
    for f in glob.glob(os.path.join(root,"src","*.js")):
        if PROD_REF in open(f).read():raise GuardError(f"GUARD: production project reference found in {os.path.basename(f)}")
def runtime_url_js():
    return "import('/src/config.js').then(m=>m.CONFIG.supabaseUrl)"
def check_runtime(ev):
    """Call before every auth or write step: asks the loaded page which URL it will use."""
    check_url(ev(runtime_url_js()))
def block_production(send):
    send("Network.enable")
    send("Network.setBlockedURLs",{"urls":[f"*{PROD_REF}*"]})
