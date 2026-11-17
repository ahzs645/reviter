import subprocess, os
W='/content/unbc'; U='/content/upload'
chk=subprocess.run(f'ls {W}/reviter/node_modules | wc -l; ls {W}/openindoormaps/node_modules | wc -l; pgrep -f recompile/run.sh | wc -l',shell=True,capture_output=True,text=True).stdout
print(chk)
env=dict(os.environ, TZ='UTC', NATIVE_WORKERS='1', LANDING_WORKERS='1', PARENT_HEAP_MIB='8192',
  BOUNDARY_PATCH_REVIEW=f'{U}/OWNER-GAP-PATCHES.native-boundary-patches.json',
  BOUNDARY_PATCH_SUPERSESSIONS=f'{U}/CONTACT-REPAIR-SUPERSESSIONS.json',
  APPLIED_BOUNDARY_PATCH_MASTER=f'{U}/applied-gap-patches-73a765e9.zip',
  REVIEW=f'{U}/DOOR-APERTURE-REVIEW.vestibules-c.json',
  NATIVE_DOOR_OWNER_REVIEW=f'{U}/NATIVE-DOOR-OWNER-REVIEW.vestibules.json')
p=subprocess.Popen(['bash',f'{W}/openindoormaps/docs/continuation/unbc-20261021/recompile/run.sh',W],stdout=open(f'{W}/run.out','a'),stderr=subprocess.STDOUT,env=env,start_new_session=True)
print('started',p.pid)
import time; time.sleep(20); print(open(f'{W}/run.out').read()[-800:])
