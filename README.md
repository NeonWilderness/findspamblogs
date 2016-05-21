#findspamblogs - findet Spam-Blogs auf der Twoday-Blogger-Plattform

##Das Problem
Die [Twoday-Blogger-Plattform](http://twoday.net) ist häufiges Ziel von Spammern, die in Form anonymer Kommentare (Kommentare nicht angemeldeter Benutzer) Spam-Links hinterlassen und dafür vor allem stillgelegte, nicht mehr aktiv betreute Blogs nutzen.

Die Blogroll Twodays zeigt auf der Hauptseite chronologisch die Änderungen an allen "öffentlichen" Blogs an. Da jeder Spam-Kommentar als Änderung registriert wird, besteht die Blogroll zunehmend aus lange verlassenen, aber kontinuierlich zugespammten Blogs und erschwert die schnelle Information der Twoday-Nutzer über tatsächlich relevante, neue oder geänderte Blogeinträge.

Durch manuellen Eingriff des Twoday-Supports kann ein als Spamziel erkannter Blog über die Deaktivierung des Kennzeichens "Weblog publik machen" dauerhaft aus der Blogroll entfernt werden. Mit Hilfe des unten beschriebenen NodeJS-Scripts `findspamblogs.js` können Spamblogs pro-aktiv ermittelt und frühzeitig aus der Blogroll genommen werden. Durch die Herausnahme erodiert auch der Linkwert für die Spammer, da unveröffentlichte Blogs/Beiträge/Kommentare nicht mehr für die Google-Analyse erreichbar sind und damit nicht mehr den Page-Rank des Spammers beeinflussen können.

##Auswahlkriterien des Scripts
Das Script liest eine gewünschte Menge von Blogrollseiten (Standard: 20 Blogrollseiten; je Seite 15 Blogs), ermittelt die Blognamen und prüft für jeden dieser Blogs, vor wie vielen Tagen der letzte (neueste) Beitrag erstellt wurde. Liegt diese Zeitspanne über einer vorgegebenen Grenze (Standard: 365 Tage), so gilt der Blog als mögliches Spamziel und wird für die weitere Analyse selektiert.

In der Folge liest das Script alle Beiträge der Blog-Hauptseite sowie - falls die Änderungshistorie zugreifbar ist - alle in der Historie gelisteten, geänderten Beiträge. Es analysiert alle Kommentare der gelesenen Beiträge auf eine mögliche Spam-Kategorisierung. Ein Kommentar gilt dann als Spam-Kommentar, wenn er von einem User mit der Kennung (Gast) oder (Guest) erstellt wurde und einen Link hinter der Gastkennung hinterlegt hat, der nicht über die Whitelist als akzeptabel eingestuft werden kann.

Die **Whitelist** ist eine normale Textdatei (UTF-8 kodiert) im gleichen Verzeichnis (Dateiname `whitelist.txt`), die zeilenweise Zeichenketten enthält, die eine Linkadresse als "Nicht-Spam" qualifiziert. Wird für die Linkadresse eines Gast-Users keinerlei Übereinstimmung mit einer (Teil-)Zeichenkette der Whitelist gefunden, so gilt der Kommentar als Spam-Kommentar.

Ab einer bestimmten Anzahl von Spam-Kommentaren (Standard: 20 Spam-Kommentare) gilt ein Blog als Spam-Blog. Das Script ermittelt alle Beiträge dieses Blogs, die Spam-Kommentare aufweisen und sammelt die Spammer-Links. Alle ermittelten Spam-Blogs werden zum Ende der Analyse in eine HTML-Liste ausgegeben.

![spamblogs](https://googledrive.com/host/0B87rILW4RVIJNlN3eUJxVWN5ZWM/spamblogs.jpg "Spamblogliste")

Spalte | Bedeutung |
:--- | :--- |
Blogalias | Alias des Twoday-Blogs, der als Spam-Blog kategorisiert wurde |
zuletzt geändert vor | Vergangene Zeitspanne bis zur letzten Änderung durch den Blogautor |
Spam-Statistik | Anzahl der verspammten vs. analysierten Blogbeiträge<br>Anzahl der Spam-Kommentare und %-Verhältnis zu analysierter Kommentaranzahl |
Spam-Infos | Klickbare Zusatzinfos:<br>Stories = Links zu den Spam-Beiträgen,<br>Spammers = Liste der Spam-Autoren/Links |

##Nutzung
###A. Einmalige Vorbereitung

####NodeJS installieren

[NodeJS](https://de.wikipedia.org/wiki/Node.js) basiert auf der JavaScript-Laufzeitumgebung "V8", die auch Bestandteil des Google Chrome Browsers ist. Mit ihr lassen sich serverseitige Scripts und Netzwerkanwendungen ausführen.

Das Programm `findspamblogs.js` ist ein NodeJS-Script und benötigt NodeJS als Laufzeitumgebung.

> Falls Sie NodeJS noch nicht installiert haben, laden Sie das passende Installationspaket von der [NodeJS-Seite](https://nodejs.org/en/) herunter und folgen Sie den Installationsanweisungen.

####Projekt klonen

Um das Programm lokal von Ihrem Rechner ausführen zu können, klonen Sie das gesamte GIT Repository in ein lokales Verzeichnis Ihrer Wahl.

> Falls Sie das git Versionsmanagement noch nicht installiert haben, laden Sie das passende Installationspaket für Ihr Betriebssystem von der [git Downloadseite](https://git-scm.com/downloads) herunter und folgen Sie den Installationsanweisungen.

Starten Sie anschließend Git Shell / Git Bash, manövrieren Sie in Ihr Entwicklungsverzeichnis (z.B. D:\Dokumente\Github) und klonen Sie das Projekt mit: `git clone https://github.com/NeonWilderness/findspamblogs.git`

Weitere Hilfe zum Klonen eines Projekts finden Sie [hier](https://help.github.com/articles/cloning-a-repository/).

####Benötigte Packages installieren

Nachdem das Projekt auf Ihren lokalen Rechner kopiert wurde, starten Sie den Node.js command prompt (Node Shell), gehen in Ihr Projektverzeichnis und installieren mit Hilfe des Node Package Managers (NPM) die noch fehlenden Packages: `npm install`

Damit sind alle Voraussetzungen für die Ausführung des `findspamblogs.js` Scripts etabliert.

###B. Ausführung

####Script-Parameter festlegen

Das Script verfügt über folgende einstellbare Ausführungsparameter:

Parameter | Kurzform | Bedeutung | Defaultwert |
--- | --- | --- | :---: |
--help | -h | Gibt einen Hilfetext aus und beendet das Script | false |
--pages={n} | -p {n} | Anzahl der zu analysierenden Blogrollseiten | 20 |
--abandoned={n} | -a {n} | Tageszahl, ab der ein Blog als "verlassen" gilt | 365 |
--minspam={n} | -m {n} | Anzahl der Spamkommentare, ab der ein Blog als Spamblog gilt | 20 |

####Script aufrufen

Öffnen Sie den Node.js command prompt (Node Shell), manövrieren in das Projektverzeichnis und starten dort das Script mit: `node findspamblogs`. Ohne die Angabe von Parametern werden die Defaultwerte herangezogen.

**Beispielaufrufe mit Parameteränderung:**

1. Durchsuche die Blogs der ersten 30 Blogrollseiten<br>
   `node findspamblogs --pages=30`

2. Durchsuche die Blogs der ersten 15 Blogrollseiten und selektiere nur Blogs mit 730 Tagen ohne Änderung<br>
   `node findspamblogs --pages=15 --abandoned=730`

3. Selektiere nur Blogs mit mindestens 10 Spam-Kommentaren<br>
   `node findspamblogs --minspam=10`

4. Kurzform: 30 Blogrollseiten, 200 Tage ohne Veränderung, 15 Spam-Kommentare<br>
   `node findspamblogs -p 30 -a 200 -m 15`

####Whitelist anpassen

Ist ein Kommentar zu Unrecht als Spam-Kommentar kategorisiert worden, kann man den Link des Benutzers ganz oder teilweise in die Whitelist aufnehmen. Wurde z.B. zu einem Beitrag ein Spam-Link mit Autorenlink "http://www.ichbinkeinspammer.de (Torben (Gast))" gemeldet, so könnte man die Zeichenkette "ichbinkeinspammer.de" in die Datei `whitelist.txt` ergänzen, damit bei zukünftigen Scriptläufen Kommentare dieses Links nicht mehr als Spam eingestuft wird.

