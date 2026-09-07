import sqlite3

DB='cable.db'

def init_database():
    conn=sqlite3.connect(DB)
    c=conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS cables(
    id INTEGER PRIMARY KEY,
    name TEXT,
    area REAL,
    resistance REAL,
    material TEXT)''')
    conn.commit()
    conn.close()


def add_cable(name,area,resistance,material):
    conn=sqlite3.connect(DB)
    conn.execute('INSERT INTO cables(name,area,resistance,material) VALUES(?,?,?,?)',(name,area,resistance,material))
    conn.commit()
    conn.close()
