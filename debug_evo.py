import sys
from bs4 import BeautifulSoup
soup = BeautifulSoup(sys.stdin.read(), 'html.parser')
evo = soup.find('div', class_='infocard-list-evo')
print(evo.prettify()[:3000] if evo else 'NOT FOUND')
