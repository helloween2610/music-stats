import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('import_playlists', Path(__file__).with_name('import-playlists.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PlaylistTests(unittest.TestCase):
    def test_favourite_outside_selected_folders(self):
        result=module.extract({'Tracks':{},'Playlists':[{'Name':'Loved mix','Playlist Persistent ID':'L','Loved':True},{'Name':'Favourite mix','Playlist Persistent ID':'F','Favorited':True},{'Name':'Other','Playlist Persistent ID':'O'}]})
        self.assertEqual({p['id'] for p in result['playlists']},{'L','F'})
        self.assertTrue(all(p['favourite'] for p in result['playlists']))

    def test_nested_folders_playlist_only_order_and_missing(self):
        d = {'Tracks': {'1': {'Name':'Owned','Persistent ID':'A'}, '2': {'Name':'Online','Playlist Only':True}}, 'Playlists':[
            {'Name':'_New Music','Folder':True,'Playlist Persistent ID':'root'},
            {'Name':'00_COLLECTION','Folder':True,'Playlist Persistent ID':'root2'},
            {'Name':'Child','Folder':True,'Playlist Persistent ID':'child','Parent Persistent ID':'root'},
            {'Name':'Mix','Playlist Persistent ID':'mix','Parent Persistent ID':'child','Playlist Items':[{'Track ID':2},{'Track ID':1},{'Track ID':2},{'Track ID':9}]},
            {'Name':'Empty','Playlist Persistent ID':'empty','Parent Persistent ID':'root2'},
            {'Name':'Unrelated','Playlist Persistent ID':'other','Playlist Items':[{'Track ID':1}]},
            {'Name':'Cycle','Folder':True,'Playlist Persistent ID':'cycle','Parent Persistent ID':'cycle'},
        ]}
        result=module.extract(d)
        self.assertEqual([p['name'] for p in result['playlists']], ['Mix','Empty'])
        self.assertEqual(result['playlists'][0]['path'], '_New Music / Child')
        self.assertEqual(result['playlists'][0]['items'], ['2','1','2','9'])
        self.assertFalse(result['tracks']['2']['inLibrary'])
        self.assertTrue(result['tracks']['1']['inLibrary'])
        self.assertTrue(result['tracks']['9']['missing'])
        self.assertEqual(result['playlists'][1]['items'], [])

if __name__ == '__main__': unittest.main()
