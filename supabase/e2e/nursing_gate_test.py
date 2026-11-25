# Nursing is intentionally not orderable. Documents what is and is not possible. wasla-test only.
import os,uuid
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
TK={n:login(str(n)) for n in (1,2,3,5)}
R=[]
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
def po(sector,item,who=1):return rpc("place_order_v2",{"p_sector":sector,"p_item_id":item,"p_address":"عنوان اختبار 7","p_notes":None,"p_source":"web","p_idempotency_key":str(uuid.uuid4()),"p_lat":None,"p_lng":None},TK[who])
items=call("/rest/v1/service_items?select=id,name,public_orderable&sector=eq.nursing",None,TK[1])[1]
chk("nursing service items exist (the original 1, 2, 3 plus the request item 15 added by draft 1500) and NONE is public_orderable",{1,2,3,15}<={i["id"] for i in items} and not any(i["public_orderable"] is not False for i in items),[(i["id"],i["public_orderable"]) for i in items])
for i in items:
    st,b=po("nursing",i["id"]);chk(f"customer cannot order nursing item {i['id']} (22023 sector gate, not a rate limit)",st==400 and b.get("code")=="22023",(st,b.get("code"),b.get("message")))
st,b=po("maintenance",4,5);chk("control (separate account to avoid the per-user rate limit): the same RPC accepts an orderable maintenance item",st==200,(st,str(b)[:70]))
st,b=po("clinic",12);chk("clinic items also refused by this RPC (clinic has its own booking RPC)",st==400 and b.get("code")=="22023",(st,b.get("code")))
st,b=call("/rest/v1/orders",{"customer_id":"00000000-0000-0000-0000-000000000000","sector":"nursing","item_id":1,"address":"x","price_egp":1},TK[1],None,"return=representation");chk("customer cannot insert a nursing order directly (no INSERT grant/policy)",st>=400,(st,str(b)[:80]))
print("DONE",sum(R),"pass",len(R)-sum(R),"fail")
